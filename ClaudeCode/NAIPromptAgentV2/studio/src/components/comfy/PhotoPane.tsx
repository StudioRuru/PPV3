"use client";
import { useEffect, useRef, useState } from "react";
import type { EngineView } from "@/lib/comfy/engine";
import { estimate } from "@/lib/comfy/estimate";
import { defaultPhoto, loadPhoto, savePhoto } from "@/lib/comfy/photo-draft";
import { fromOpenPose, moveJoint } from "@/lib/comfy/pose";
import type { PhotoRecipe, PoseRef } from "@/lib/comfy/recipe";
import { requestJson } from "@/lib/net";
import { Drawer } from "./Drawer";
import { LoraStack } from "./LoraStack";
import { EMPTY_POSE, PoseOverlay, PoseTool, type PoseState, renderSkeleton } from "./PoseEditor";
import { TuneSheet } from "./TuneSheet";

type Models = { checkpoints: string[]; loras: string[]; samplers: string[]; schedulers: string[] };
type JobView = { status: "queued" | "running" | "done" | "error"; progress: number; error: string | null; itemId: number | null; result?: { image: string; keypoints: unknown } };
type Tool = "model" | "lora" | "pose" | "tune";
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (n: string) => n.replace(/\.safetensors$/, "");

/** Photo sub-tab: canvas, tool chips (Model · LoRA · Pose · Tune) and the drawer that hosts them. */
export function PhotoPane({ active, view, prompt, onPrompt }: { active: boolean; view: EngineView | null; prompt: string; onPrompt: (v: string) => void }) {
  const [r, setR] = useState<PhotoRecipe>(() => defaultPhoto([]));
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<Models | null>(null);
  const [tool, setTool] = useState<Tool>("model");
  const [open, setOpen] = useState(false);
  const [pose, setPoseState] = useState<PoseState>(EMPTY_POSE);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const alive = useRef(true);
  const setPose = (p: Partial<PoseState>) => setPoseState((s) => ({ ...s, ...p }));
  const patch = (p: Partial<PhotoRecipe>) => setR((x) => ({ ...x, ...p }));

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const d = loadPhoto();
    if (d) { setR(d); if (d.prompt) onPrompt(d.prompt); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) savePhoto({ ...r, prompt }); }, [r, prompt, ready]);

  // Model lists come from the GPU: poll until it answers.
  useEffect(() => {
    if (!active || models) return;
    let stop = false;
    const go = async () => {
      const res = await requestJson<Models | { pending: true }>("/api/comfy/models");
      if (stop) return;
      if (res.ok && !("pending" in res.data)) { const m = res.data; setModels(m); setR((x) => (x.model ? x : { ...x, model: m.checkpoints[0] ?? "" })); }
    };
    void go();
    const t = setInterval(go, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [active, models]);

  /** Polls a job every second until it finishes; retries a few network blips. */
  const poll = async (id: number, tick?: (j: JobView) => void): Promise<JobView> => {
    let fails = 0;
    for (;;) {
      const res = await requestJson<JobView>(`/api/comfy/jobs/${id}`);
      if (!alive.current) return { status: "error", progress: 0, error: "Cancelled.", itemId: null };
      if (!res.ok) { if (++fails > 5) return { status: "error", progress: 0, error: res.error, itemId: null }; }
      else {
        fails = 0;
        tick?.(res.data);
        if (res.data.status === "done" || res.data.status === "error") return res.data;
      }
      await sleep(1000);
    }
  };

  const extract = async () => {
    if (!pose.refUrl) return;
    setPose({ busy: true, error: null });
    const res = await requestJson<{ id: number }>("/api/comfy/jobs", post({ kind: "pose", recipe: { kind: pose.kind }, image: pose.refUrl }));
    if (!res.ok) return setPose({ busy: false, error: res.error });
    const j = await poll(res.data.id);
    if (!alive.current) return;
    if (j.status !== "done" || !j.result) return setPose({ busy: false, error: j.error ?? "Extraction failed." });
    if (pose.kind !== "pose") return setPose({ busy: false, extracted: j.result.image });
    const kp = fromOpenPose(j.result.keypoints);
    setPose(kp ? { busy: false, extracted: j.result.image, kp, orig: kp } : { busy: false, error: "No person found in that photo." });
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setJob({ status: "queued", progress: 0, error: null, itemId: null });
    let poseRef: PoseRef | null = null;
    let poseImage: string | undefined;
    if (pose.kind === "pose" && pose.kp) { poseRef = { kind: "pose", image: "pose.png", strength: pose.strength }; poseImage = renderSkeleton(pose.kp, r.width, r.height); }
    else if (pose.kind !== "pose" && pose.extracted) poseRef = { kind: pose.kind, image: pose.extracted, strength: pose.strength };
    const res = await requestJson<{ id: number }>("/api/comfy/jobs", post({ kind: "photo", recipe: { ...r, prompt, pose: poseRef }, poseImage }));
    if (!res.ok) { setJob(null); setBusy(false); return setError(res.error); }
    const j = await poll(res.data.id, setJob);
    if (!alive.current) return;
    setBusy(false);
    if (j.status === "error" || j.itemId == null) { setJob(null); return setError(j.error ?? "Generation failed."); }
    const items = await requestJson<{ items: { id: number; file: string }[] }>("/api/comfy/items");
    const it = items.ok ? items.data.items.find((i) => i.id === j.itemId) : undefined;
    setJob(null);
    if (it) setShot(it.file);
    else setError("Done — it's in the Library.");
  };

  const est = estimate({ ...r, prompt, pose: null }, view?.gpu ?? "", view?.usdHr ?? 0);
  const poseOn = (pose.kind === "pose" && !!pose.kp) || (pose.kind !== "pose" && !!pose.extracted);
  const chips: [Tool, string][] = [["model", r.model ? short(r.model) : "Model"], ["lora", r.loras.length ? `LoRA · ${r.loras.length}` : "LoRA"], ["pose", poseOn ? "Pose ✓" : "Pose"], ["tune", "Tune"]];
  const note = job ? (job.status === "queued" ? "Queued — GPU warming" : `Rendering ${Math.round(job.progress * 100)}%`) : error ?? `≈ ${est.seconds}s${view ? ` · $${est.usd.toFixed(2)}` : ""}`;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Photo tools">
        {chips.map(([t, label]) => (
          <button key={t} type="button" aria-pressed={open && tool === t} onClick={() => { setTool(t); setOpen(true); }}
            className={`min-h-11 max-w-44 shrink-0 truncate rounded-full border px-4 text-sm ${open && tool === t ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`}>{label}</button>
        ))}
      </div>
      <div className="bg-surface border-border relative mx-auto overflow-hidden rounded-lg border" style={{ aspectRatio: `${r.width}/${r.height}`, width: `min(100%, ${(50 * r.width) / r.height}vh)` }}>
        {shot ? <img src={`/api/comfy/file/${shot}`} alt="Latest photo" className="size-full object-fill" />
          : pose.refUrl && pose.kp ? <img src={pose.refUrl} alt="" className="size-full object-fill opacity-40" />
          : <div className="text-muted grid size-full place-items-center p-6 text-center text-sm">Your photo appears here.</div>}
        {pose.kind === "pose" && pose.kp && <PoseOverlay kp={pose.kp} onMove={(i, x, y) => setPoseState((s) => (s.kp ? { ...s, kp: moveJoint(s.kp, i, x, y) } : s))} />}
      </div>
      <Drawer open={open} onOpenChange={setOpen} prompt={prompt} onPrompt={onPrompt} placeholder="Describe the picture…" action={busy ? "Working…" : "Make photo"}
        onAction={() => void generate()} disabled={busy || !prompt.trim() || !r.model} progress={job?.status === "running" ? job.progress : null} note={note}>
        {tool === "model" && (
          models ? (
            <div className="flex flex-wrap gap-2">
              {models.checkpoints.map((m) => (
                <button key={m} type="button" aria-pressed={r.model === m} onClick={() => patch({ model: m })}
                  className={`min-h-11 rounded-full border px-3 text-xs ${r.model === m ? "bg-accent text-accent-fg border-accent" : "border-border text-muted"}`}>{short(m)}</button>
              ))}
            </div>
          ) : <p className="text-muted text-sm">Waiting for GPU…</p>
        )}
        {tool === "lora" && <LoraStack loras={r.loras} available={models?.loras ?? null} onChange={(loras) => patch({ loras })} />}
        {tool === "pose" && <PoseTool st={pose} set={setPose} onExtract={() => void extract()} onClear={() => setPoseState(EMPTY_POSE)} />}
        {tool === "tune" && <TuneSheet r={r} samplers={models?.samplers ?? []} schedulers={models?.schedulers ?? []} onChange={patch} />}
      </Drawer>
    </>
  );
}
