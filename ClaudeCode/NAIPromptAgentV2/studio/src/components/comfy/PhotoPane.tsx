"use client";
import { useEffect, useRef, useState } from "react";
import type { EngineView } from "@/lib/comfy/engine";
import { estimate } from "@/lib/comfy/estimate";
import { defaultPhoto, loadPhoto, photoTune, savePhoto } from "@/lib/comfy/photo-draft";
import { restoreTake } from "@/lib/comfy/reuse";
import type { Item } from "@/lib/comfy/store";
import { fromOpenPose, moveJoint } from "@/lib/comfy/pose";
import { family, isDit, isQwen, type Lora, type LoraInfo, type PhotoRecipe, type PoseRef } from "@/lib/comfy/recipe";
import { addTriggers, removeTriggers } from "@/lib/comfy/triggers";
import { requestJson } from "@/lib/net";
import { CopilotPanel } from "./CopilotPanel";
import { Drawer, type JobView, useJob } from "./Drawer";
import { LoraStack } from "./LoraStack";
import { EMPTY_POSE, PoseOverlay, PoseTool, type PoseState, renderSkeleton } from "./PoseEditor";
import { EMPTY_SWAP, type SwapState, SwapTool } from "./SwapTool";
import { TakeStrip } from "./TakeStrip";
import { TuneSheet } from "./TuneSheet";
import { useWide } from "./useWide";

type Models = { checkpoints: string[]; loras: string[]; samplers: string[]; schedulers: string[] };
type Tool = "model" | "lora" | "pose" | "swap" | "tune";
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const short = (n: string) => n.replace(/\.safetensors$/, "");

/** Photo sub-tab: canvas, tool chips (Model · LoRA · Pose or Swap · Tune) and the drawer that hosts them. */
export function PhotoPane({ active, view, prompt, onPrompt, onShot, load }: { active: boolean; view: EngineView | null; prompt: string; onPrompt: (v: string) => void; onShot?: (item: { id: number; file: string }) => void; load?: { recipe: PhotoRecipe; nonce: number } }) {
  const [r, setR] = useState<PhotoRecipe>(() => defaultPhoto([]));
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<Models | null>(null);
  const [loraInfo, setLoraInfo] = useState<Record<string, LoraInfo>>({});
  const [tool, setTool] = useState<Tool>("model");
  const [open, setOpen] = useState(false);
  const [pose, setPoseState] = useState<PoseState>(EMPTY_POSE);
  const [swap, setSwapState] = useState<SwapState>(EMPTY_SWAP);
  const setSwap = (p: Partial<SwapState>) => setSwapState((s) => ({ ...s, ...p }));
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const wide = useWide();
  const [takes, setTakes] = useState<Item[]>([]);
  const [compare, setCompare] = useState<string | null>(null);
  useEffect(() => { if (!wide) setCompare(null); }, [wide]);
  const { poll, alive } = useJob();
  const kindRef = useRef<PoseRef["kind"]>(pose.kind);
  kindRef.current = pose.kind;
  // Editing the skeleton (Mirror, Reset, load, extract) brings the overlay back over the finished photo.
  const setPose = (p: Partial<PoseState>) => { if ("kp" in p) setShot(null); setPoseState((s) => ({ ...s, ...p })); };
  const patch = (p: Partial<PhotoRecipe>) => setR((x) => ({ ...x, ...p }));
  // LoRAs and poses don't carry across models; a family change also resets the tune.
  const pickModel = (model: string) => {
    if (model === r.model) return;
    const inserted = r.loras.flatMap((l) => l.words ?? []);
    if (inserted.length) onPrompt(removeTriggers(prompt, inserted));
    patch({ model, loras: [], ...(family(model) !== family(r.model) ? photoTune(model) : {}) });
    setPoseState(EMPTY_POSE);
  };

  const holds = (ls: Lora[], w: string) => ls.some((l) => l.words?.some((x) => x.toLowerCase() === w.toLowerCase()));
  const addLora = (name: string) => {
    const info = loraInfo[name];
    const { prompt: p, inserted } = addTriggers(prompt, info?.words ?? []);
    // Words another LoRA already inserted are recorded here too, so they stay if that LoRA goes first.
    const shared = (info?.words ?? []).filter((w) => !inserted.includes(w) && holds(r.loras, w));
    if (inserted.length) onPrompt(p);
    patch({ loras: [...r.loras, { name, strength: info?.weight ?? 0.8, words: [...inserted, ...shared] }] });
  };
  const removeLora = (i: number) => {
    const rest = r.loras.filter((_, j) => j !== i);
    const gone = (r.loras[i].words ?? []).filter((w) => !holds(rest, w));
    if (gone.length) onPrompt(removeTriggers(prompt, gone));
    patch({ loras: rest });
  };

  // Desktop takes strip: newest 30 photos, read once when the wide layout first shows. A failed fetch leaves it empty.
  const takesLoaded = useRef(false);
  useEffect(() => {
    if (!wide || takesLoaded.current) return;
    takesLoaded.current = true;
    void requestJson<{ items: Item[] }>("/api/comfy/items").then((res) => {
      if (res.ok && Array.isArray(res.data.items)) setTakes((t) => { const have = new Set(t.map((x) => x.id)); return [...t, ...res.data.items.filter((i) => i.kind === "photo" && !have.has(i.id))].sort((a, b) => b.id - a.id).slice(0, 30); });
    });
  }, [wide]);
  const restore = (it: Item) => {
    const t = restoreTake(it);
    if (!t) return;
    setR(t.recipe); onPrompt(t.recipe.prompt); setShot(it.file); setError(null);
    setPoseState(t.pose ? { ...EMPTY_POSE, kind: t.pose.kind, extracted: t.pose.image, strength: t.pose.strength } : EMPTY_POSE);
    setSwapState(t.swap ? { on: true, base: { file: t.swap.base }, head: { file: t.swap.head } } : EMPTY_SWAP);
  };

  useEffect(() => {
    const d = loadPhoto();
    if (d) { setR(d); if (d.prompt) onPrompt(d.prompt); }
    setReady(true);
  }, []);
  // Library "Reuse": the pane stays mounted, so a new nonce pushes the recipe in.
  useEffect(() => {
    if (!load) return;
    setR(load.recipe); onPrompt(load.recipe.prompt); setShot(null); setPoseState(EMPTY_POSE); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.nonce]);
  useEffect(() => { if (ready) savePhoto({ ...r, prompt }); }, [r, prompt, ready]);

  // Model lists come from the GPU: poll until it answers.
  useEffect(() => {
    if (!active || models) return;
    let stop = false;
    const go = async () => {
      const res = await requestJson<Models | { pending: true }>("/api/comfy/models");
      if (stop) return;
      if (res.ok && !("pending" in res.data)) { const m = res.data; setModels(m); setR((x) => (x.model ? x : { ...x, model: m.checkpoints[0] ?? "", ...photoTune(m.checkpoints[0] ?? "") })); }
    };
    void go();
    const t = setInterval(go, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [active, models]);

  // Family and trigger words per pod LoRA; a failed lookup leaves the list unfiltered.
  const loraKey = models?.loras.join(",") ?? "";
  useEffect(() => {
    if (!loraKey) return;
    let stop = false;
    void requestJson<{ info: Record<string, LoraInfo> }>(`/api/comfy/lora-info?names=${encodeURIComponent(loraKey)}`).then((res) => { if (!stop && res.ok) setLoraInfo(res.data.info); });
    return () => { stop = true; };
  }, [loraKey]);

  const extract = async () => {
    if (!pose.refUrl) return;
    const kind = pose.kind;
    setPose({ busy: true, error: null });
    const res = await requestJson<{ id: number }>("/api/comfy/jobs", post({ kind: "pose", recipe: { kind: pose.kind }, image: pose.refUrl }));
    if (!res.ok) return setPose({ busy: false, error: res.error });
    const j = await poll(res.data.id);
    if (!alive.current) return;
    if (kindRef.current !== kind) return setPose({ busy: false });
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
    // Library picks travel as names in recipe.swap; uploads as swapImages, which the route saves and names.
    const sw = swapOn && swap.base && swap.head ? { base: swap.base, head: swap.head } : null;
    const name = (s: NonNullable<SwapState["base"]>) => ("file" in s ? s.file : "upload.png");
    const swapImages = sw && { base: "data" in sw.base ? sw.base.data : undefined, head: "data" in sw.head ? sw.head.data : undefined };
    const res = await requestJson<{ id: number }>("/api/comfy/jobs", post({ kind: "photo", recipe: { ...r, prompt, pose: poseRef, swap: sw && { base: name(sw.base), head: name(sw.head) } }, poseImage, swapImages }));
    if (!res.ok) { setJob(null); setBusy(false); return setError(res.error); }
    const j = await poll(res.data.id, setJob);
    if (!alive.current) return;
    setBusy(false);
    if (j.status === "error" || j.itemId == null) { setJob(null); return setError(j.error ?? "Generation failed."); }
    const items = await requestJson<{ items: Item[] }>("/api/comfy/items");
    const it = items.ok ? items.data.items.find((i) => i.id === j.itemId) : undefined;
    setJob(null);
    if (it) { setShot(it.file); onShot?.(it); setTakes((t) => [it, ...t.filter((x) => x.id !== it.id)].slice(0, 30)); }
    else setError("Done — it's in the Library.");
  };

  const est = estimate({ ...r, prompt, pose: null }, view?.gpu ?? "", view?.usdHr ?? 0);
  const poseOn = (pose.kind === "pose" && !!pose.kp) || (pose.kind !== "pose" && !!pose.extracted);
  const qwen = isQwen(r.model), dit = isDit(r.model);
  const swapOn = qwen && swap.on;
  const swapReady = swapOn && !!swap.base && !!swap.head;
  const chips = ([["model", r.model ? short(r.model) : "Model"], ["lora", r.loras.length ? `LoRA · ${r.loras.length}` : "LoRA"], ["pose", poseOn ? "Pose ✓" : "Pose"], ["swap", swapReady ? "Swap ✓" : "Swap head"], ["tune", "Tune"]] as [Tool, string][])
    .filter(([t]) => (t === "pose" ? !dit : t === "swap" ? qwen : true));
  const note = job ? (job.status === "queued" ? "Queued — GPU warming" : `Rendering ${Math.round(job.progress * 100)}%`) : error ?? (models && r.model && !models.checkpoints.includes(r.model) ? "Model no longer on the GPU" : null) ?? `≈ ${est.seconds}s${view ? ` · $${est.usd.toFixed(2)}` : ""}`;

  const modelEl = models ? (
    <div className="flex flex-wrap gap-2">
      {models.checkpoints.map((m) => (
        <button key={m} type="button" aria-pressed={r.model === m} onClick={() => pickModel(m)}
          className={`min-h-11 rounded-full border px-3 text-xs ${r.model === m ? "bg-accent text-accent-fg border-accent" : "border-border text-muted"}`}>{short(m)}</button>
      ))}
    </div>
  ) : <p className="text-muted text-sm">Waiting for GPU…</p>;
  const loraEl = <LoraStack loras={r.loras} available={models?.loras ?? null} onChange={(loras) => patch({ loras })} info={loraInfo} fit={family(r.model)} onAdd={addLora} onRemove={removeLora} />;
  const poseEl = <PoseTool st={pose} set={setPose} onExtract={() => void extract()} onClear={() => setPoseState(EMPTY_POSE)} />;
  const swapEl = <SwapTool st={swap} set={setSwap} />;
  const tuneEl = <TuneSheet r={r} samplers={models?.samplers ?? []} schedulers={models?.schedulers ?? []} onChange={patch} />;
  const canvasInner = (fit: "fill" | "contain") => (
    <>
      {shot ? <img src={`/api/comfy/file/${shot}`} alt="Latest photo" className={`size-full ${fit === "contain" ? "object-contain" : "object-fill"}`} />
        : pose.refUrl && pose.kp ? <img src={pose.refUrl} alt="" className="size-full object-fill opacity-40" />
        : <div className="text-muted grid size-full place-items-center p-6 text-center text-sm">Your photo appears here.</div>}
      {!shot && pose.kind === "pose" && pose.kp && <PoseOverlay kp={pose.kp} onMove={(i, x, y) => setPoseState((s) => (s.kp ? { ...s, kp: moveJoint(s.kp, i, x, y) } : s))} />}
    </>
  );
  const modelGone = !!models && !!r.model && !models.checkpoints.includes(r.model);
  const disabled = busy || !r.model || modelGone || (swapOn ? !swapReady : !prompt.trim());

  if (wide) {
    const panel = "border-border space-y-2 rounded-lg border p-3";
    const label = "text-faint text-xs font-semibold uppercase tracking-wide";
    return (
      <div className="grid h-[calc(100dvh-16rem)] min-h-[32rem] gap-4" style={{ gridTemplateColumns: "320px 96px 1fr 300px" }}>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className={panel}><p className={label}>Model</p>{modelEl}</div>
          <div className={panel}><p className={label}>LoRA</p>{loraEl}</div>
          <textarea value={prompt} onChange={(e) => onPrompt(e.target.value)} placeholder="Describe the picture…" rows={5} aria-label="Prompt"
            className="bg-surface border-border w-full rounded-lg border p-3 text-sm" />
          {!dit && <div className={panel}><p className={label}>Pose</p>{poseEl}</div>}
          {qwen && <div className={panel}><p className={label}>Swap head</p>{swapEl}</div>}
          <div className={panel}><p className={label}>Tune</p>{tuneEl}</div>
          <button type="button" onClick={() => void generate()} disabled={disabled} className="bg-accent text-accent-fg min-h-11 w-full rounded-full font-semibold disabled:opacity-50">{busy ? "Working…" : "Make photo"}</button>
          <p className="text-muted text-center text-xs">{note}</p>
        </div>
        <TakeStrip takes={takes} current={shot} onRestore={restore} onCompare={setCompare} />
        <div className="grid min-h-0 min-w-0 place-items-center">
          {compare ? <img src={`/api/comfy/file/${compare}`} alt="Compared take" className="max-h-full max-w-full object-contain" />
            : <div className="bg-surface border-border relative overflow-hidden rounded-lg border" style={{ aspectRatio: `${r.width}/${r.height}`, maxHeight: "100%", maxWidth: "100%", height: "100%" }}>{canvasInner("contain")}</div>}
        </div>
        <aside aria-label="Miyabi" className="min-h-0"><CopilotPanel recipe={{ ...r, prompt }} onApply={({ prompt: p, ...rest }) => { if (p !== undefined) onPrompt(p); patch(rest); }} /></aside>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Photo tools">
        {chips.map(([t, label]) => (
          <button key={t} type="button" aria-pressed={open && tool === t} onClick={() => { setTool(t); setOpen(true); if (t === "lora") void requestJson<Models | { pending: true }>("/api/comfy/models").then((res) => { if (res.ok && !("pending" in res.data)) setModels(res.data); }); }}
            className={`min-h-11 max-w-44 shrink-0 truncate rounded-full border px-4 text-sm ${open && tool === t ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`}>{label}</button>
        ))}
      </div>
      <div className="bg-surface border-border relative mx-auto overflow-hidden rounded-lg border" style={{ aspectRatio: `${r.width}/${r.height}`, width: `min(100%, ${(50 * r.width) / r.height}vh)` }}>
        {canvasInner("fill")}
      </div>
      <Drawer open={open} onOpenChange={setOpen} prompt={prompt} onPrompt={onPrompt} placeholder="Describe the picture…" action={busy ? "Working…" : "Make photo"}
        onAction={() => void generate()} disabled={disabled} progress={job?.status === "running" ? job.progress : null} note={note}>
        {tool === "model" && modelEl}
        {tool === "lora" && loraEl}
        {tool === "pose" && !dit && poseEl}
        {tool === "swap" && qwen && swapEl}
        {tool === "tune" && tuneEl}
      </Drawer>
    </>
  );
}
