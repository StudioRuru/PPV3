"use client";
import { useEffect, useState } from "react";
import type { EngineView } from "@/lib/comfy/engine";
import { estimate } from "@/lib/comfy/estimate";
import { defaultVideo, loadVideo, saveVideo, videoTune } from "@/lib/comfy/photo-draft";
import type { VideoRecipe } from "@/lib/comfy/recipe";
import { gpuName } from "@/lib/comfy/view";
import { requestJson } from "@/lib/net";
import { Drawer, useJob } from "./Drawer";
import { LoraStack } from "./LoraStack";
import { MotionSheet } from "./MotionSheet";

type LibItem = { id: number; kind: "photo" | "clip"; file: string; poster: string | null };
type Tool = "motion" | "lora" | "start" | "end";
type Mode = VideoRecipe["mode"];
// Room for more modes later: add an entry here.
const MODES: [Mode, string][] = [["animate", "Animate image"], ["t2v", "Text → video"], ["extend", "Extend clip"], ["loop", "Loop"]];
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const thumb = (i: LibItem) => `/api/comfy/file/${i.kind === "clip" ? i.poster ?? i.file : i.file}`;

/** Video sub-tab: mode chips, start frame, canvas with the finished clip, and the drawer (Motion · Library picker). */
export function VideoPane({ view, boostView, lastPhoto, load }: { view: EngineView | null; boostView: EngineView | null; lastPhoto: { id: number; file: string } | null; load?: { recipe: VideoRecipe; nonce: number; thumb?: string; tool?: "start" } }) {
  const [r, setR] = useState<VideoRecipe>(defaultVideo);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("motion");
  const [open, setOpen] = useState(false);
  const [lib, setLib] = useState<LibItem[] | null>(null);
  const [loraNames, setLoraNames] = useState<string[] | null>(null);
  const [startThumb, setStartThumb] = useState<string | null>(null);
  const [job, setJob] = useState<{ status: string; progress: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const { poll, alive } = useJob();
  const patch = (p: Partial<VideoRecipe>) => setR((x) => ({ ...x, ...p }));

  useEffect(() => {
    const d = loadVideo();
    // Library ids from a past session may be gone, so the frames are picked again.
    if (d) setR({ ...d, start: null, end: null });
    setReady(true);
  }, []);
  // Library "Reuse" / "Animate this": the pane stays mounted, so a new nonce pushes the recipe in.
  useEffect(() => {
    if (!load) return;
    setR(load.recipe); setStartThumb(load.thumb ?? null); setClip(null); setError(null);
    if (load.tool) openTool(load.tool); // Scene "Send to Video": open the start-frame drawer once per nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.nonce]);
  useEffect(() => { if (ready) saveVideo(r); }, [r, ready]);

  const openTool = (t: Tool) => {
    setTool(t);
    setOpen(true);
    // ponytail: one fetch per open; a cold GPU shows "Waiting for GPU…" until the LoRA tool is reopened
    if (t === "lora") { void requestJson<{ loras?: string[]; videoLoras?: string[] }>("/api/comfy/models").then((x) => { const l = x.ok ? x.data.videoLoras ?? x.data.loras : undefined; if (alive.current && l) setLoraNames(l); }); return; }
    if (t !== "motion") { setLib(null); void requestJson<{ items: LibItem[] }>("/api/comfy/items").then((x) => { if (alive.current) setLib(x.ok ? x.data.items : []); }); }
  };
  const setMode = (mode: Mode) => {
    // An extend start is a clip, any other start is a photo: they don't carry over.
    // Smooth Mix i2v and the 5B T2V want different steps/CFG.
    const tune = (mode === "t2v") !== (r.mode === "t2v") ? videoTune(mode) : {};
    if ((mode === "extend") !== (r.mode === "extend")) { patch({ mode, start: null, end: null, ...tune }); setStartThumb(null); }
    else patch({ mode, ...tune });
  };
  const pick = (i: LibItem) => {
    if (tool === "end") patch({ end: i.id });
    else { patch({ start: i.id }); setStartThumb(thumb(i)); }
    setOpen(false);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setJob({ status: "queued", progress: 0 });
    const recipe = { ...r, start: r.mode === "t2v" ? null : r.start, end: r.mode === "animate" ? r.end : null };
    const res = await requestJson<{ id: number }>("/api/comfy/jobs", post({ kind: "video", recipe }));
    if (!res.ok) { setJob(null); setBusy(false); return setError(res.error); }
    const j = await poll(res.data.id, setJob);
    if (!alive.current) return;
    setBusy(false);
    if (j.status === "error" || j.itemId == null) { setJob(null); return setError(j.error ?? "Generation failed."); }
    const items = await requestJson<{ items: LibItem[] }>("/api/comfy/items");
    const it = items.ok ? items.data.items.find((i) => i.id === j.itemId) : undefined;
    setJob(null);
    if (it) setClip(it.file);
    else setError("Done — it's in the Library.");
  };

  // Boost sends every mode but text-to-video to the H100 card.
  const h100 = view?.boost === "on" && r.mode !== "t2v";
  const gpu = h100 ? "H100" : gpuName(view?.gpu ?? null);
  const usdHr = (h100 ? boostView?.usdHr : view?.usdHr) ?? 0;
  const est = estimate(r, gpu, usdHr);
  const estLine = `~${Math.max(1, Math.round(est.seconds / 60))} min on ${gpu}${usdHr ? ` ≈ $${est.usd.toFixed(2)}` : ""}`;
  const needStart = r.mode !== "t2v" && r.start == null;
  const note = job ? (job.status === "queued" ? "Queued — GPU warming" : `Rendering ${Math.round(job.progress * 100)}%`) : error ?? estLine;
  const shown = (lib ?? []).filter((i) => (tool === "start" && r.mode === "extend" ? i.kind === "clip" && !!i.poster : i.kind === "photo"));
  const btn = (on: boolean) => `min-h-11 shrink-0 rounded-full border px-4 text-sm ${on ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`;

  return (
    <>
      <div role="group" aria-label="Video mode" className="flex gap-2 overflow-x-auto">
        {MODES.map(([m, label]) => <button key={m} type="button" aria-pressed={r.mode === m} onClick={() => setMode(m)} className={btn(r.mode === m)}>{label}</button>)}
      </div>
      <div role="group" aria-label="Video tools" className="flex gap-2">
        <button type="button" aria-pressed={open && tool === "motion"} onClick={() => openTool("motion")} className={btn(open && tool === "motion")}>Motion · {r.seconds} s</button>
        <button type="button" aria-pressed={open && tool === "lora"} onClick={() => openTool("lora")} className={btn(open && tool === "lora")}>{r.loras.length ? `LoRA · ${r.loras.length}` : "LoRA"}</button>
      </div>
      {r.mode !== "t2v" && (
        <div role="group" aria-label="Start frame" className="flex items-center gap-2">
          <span className="text-muted text-xs">{r.mode === "extend" ? "Clip" : "Start"}</span>
          {r.mode !== "extend" && lastPhoto && (
            <button type="button" aria-pressed={r.start === lastPhoto.id} onClick={() => { patch({ start: lastPhoto.id }); setStartThumb(`/api/comfy/file/${lastPhoto.file}`); }} className={btn(r.start === lastPhoto.id)}>
              Last Photo{r.start === lastPhoto.id ? " ✓" : ""}
            </button>
          )}
          <button type="button" onClick={() => openTool("start")} className={btn(false)}>Pick…</button>
          {r.start != null && startThumb && <img src={startThumb} alt="Chosen start frame" className="border-border h-11 rounded-md border object-cover" />}
        </div>
      )}
      <div className="bg-surface border-border mx-auto aspect-video w-full overflow-hidden rounded-lg border">
        {clip ? <video key={clip} src={`/api/comfy/file/${clip}`} playsInline loop muted autoPlay controls className="size-full object-contain" />
          : <div className="text-muted grid size-full place-items-center p-6 text-center text-sm">Your clip appears here.</div>}
      </div>
      <Drawer open={open} onOpenChange={setOpen} prompt={r.prompt} onPrompt={(prompt) => patch({ prompt })} placeholder={r.mode === "t2v" ? "Describe the scene…" : "One sentence per 5 s — move what's already in the frame…"}
        action={busy ? "Working…" : r.mode === "t2v" ? "Make clip" : "Animate"} onAction={() => void generate()} disabled={busy || needStart || (r.mode === "t2v" && !r.prompt.trim())}
        progress={job?.status === "running" ? job.progress : null} note={note}>
        {tool === "motion" ? <MotionSheet r={r} onChange={patch} onPickEnd={() => openTool("end")} endSet={r.end != null} />
          : tool === "lora" ? <LoraStack loras={r.loras} available={loraNames} onChange={(loras) => patch({ loras })} />
          : lib === null ? <p className="text-muted text-sm">Loading Library…</p>
          : shown.length === 0 ? <p className="text-muted text-sm">{tool === "start" && r.mode === "extend" ? "No clips yet." : "No photos yet."}</p>
          : (
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
              {shown.map((i) => (
                <button key={i.id} type="button" aria-label={`Pick ${i.kind} ${i.id}`} onClick={() => pick(i)} className="border-border aspect-square overflow-hidden rounded-md border">
                  <img src={thumb(i)} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        {tool === "motion" ? null : <button type="button" onClick={() => openTool("motion")} className="text-muted mt-2 min-h-11 text-sm">Back to Motion</button>}
      </Drawer>
    </>
  );
}
