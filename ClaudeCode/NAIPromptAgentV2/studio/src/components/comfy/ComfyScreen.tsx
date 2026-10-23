"use client";
import { useEffect, useRef, useState } from "react";
import type { EngineView } from "@/lib/comfy/engine";
import { defaultVideo, loadVideo as loadVideoDraft } from "@/lib/comfy/photo-draft";
import type { PhotoRecipe, VideoRecipe } from "@/lib/comfy/recipe";
import { asStartFrame, reuseTarget } from "@/lib/comfy/reuse";
import type { Item } from "@/lib/comfy/store";
import { requestJson } from "@/lib/net";
import { useWide } from "./useWide";
import { PhotoPane } from "./PhotoPane";
import { LibraryPane } from "./LibraryPane";
import { VideoPane } from "./VideoPane";
import { SpritesScreen } from "./sprites/SpritesScreen";
import { GpuLine, type EngineAction } from "./GpuLine";

type Sub = "photo" | "video" | "sprites" | "library";
const SUBS: { id: Sub; label: string }[] = [{ id: "photo", label: "Photo" }, { id: "video", label: "Video" }, { id: "sprites", label: "Sprites" }, { id: "library", label: "Library" }];
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** ComfyUI tab: GPU status line + sub-tabs. Opening the tab pre-warms the GPU once; the prompt and drawer work whatever the GPU is doing. */
export function ComfyScreen({ active }: { active: boolean }) {
  const [sub, setSub] = useState<Sub>("photo");
  const [view, setView] = useState<EngineView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [boostView, setBoostView] = useState<EngineView | null>(null);
  const [lastPhoto, setLastPhoto] = useState<{ id: number; file: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loadPhoto, setLoadPhoto] = useState<{ recipe: PhotoRecipe; nonce: number }>();
  const [loadVideo, setLoadVideo] = useState<{ recipe: VideoRecipe; nonce: number; thumb?: string }>();
  const warmed = useRef(false);
  const wide = useWide();
  const bleed = wide && sub === "photo"; // desktop Photo uses the full window, not the 6xl column
  // Library actions: push the recipe into the (mounted) pane, then switch to it.
  const reuse = (it: Item) => {
    const t = reuseTarget(it);
    if (t.pane === "photo") setLoadPhoto({ recipe: t.recipe, nonce: Date.now() });
    else setLoadVideo({ recipe: t.recipe, nonce: Date.now() });
    setSub(t.pane);
  };
  const animate = (it: Item) => {
    setLoadVideo({ recipe: asStartFrame(it, loadVideoDraft() ?? defaultVideo()), nonce: Date.now(), thumb: `/api/comfy/file/${it.file}` });
    setSub("video");
  };

  // Errors from warm/actions stay until the next action succeeds; a poll only clears (or sets) its own error.
  const pollErr = useRef(false);
  const apply = (r: Awaited<ReturnType<typeof requestJson<EngineView | { main: EngineView; boost?: EngineView }>>>, from: "poll" | "action" = "action") => {
    if (!r.ok) { setError(r.error); pollErr.current = from === "poll"; return; }
    if (from === "action" || pollErr.current) { setError(null); pollErr.current = false; }
    if ("main" in r.data) { setView(r.data.main); setBoostView(r.data.boost ?? null); } else setView(r.data);
  };

  useEffect(() => { // "Open Sprites studio" in the mascot sprite studio
    const f = () => setSub("sprites");
    window.addEventListener("comfy:sprites", f);
    return () => window.removeEventListener("comfy:sprites", f);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!warmed.current) { warmed.current = true; requestJson<EngineView>("/api/comfy/engine", post({ action: "warm" })).then(apply); }
    const poll = () => requestJson<{ main: EngineView; boost: EngineView }>("/api/comfy/engine").then((r) => apply(r, "poll"));
    poll();
    const p = setInterval(poll, 5000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(p); clearInterval(t); };
  }, [active]);

  const act = (a: EngineAction) => requestJson<EngineView>("/api/comfy/engine", post(a)).then((r) => {
    if (!r.ok) { setError(r.error); pollErr.current = false; }
    else { setError(null); pollErr.current = false; requestJson<{ main: EngineView; boost: EngineView }>("/api/comfy/engine").then((q) => apply(q, "poll")); }
  });

  return (
    <section className={`space-y-3 ${bleed ? "relative left-1/2 w-[calc(100vw-2rem)] -translate-x-1/2 pb-4" : "pb-[calc(env(safe-area-inset-bottom)+14rem)]"}`}>
      <h1 className="text-[15px] font-semibold tracking-wide">ComfyUI</h1>
      <GpuLine view={view} boostView={boostView} now={now} onAction={act} error={error} />
      <div role="tablist" aria-label="ComfyUI sections" className="flex gap-2">
        {SUBS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={sub === s.id} onClick={() => setSub(s.id)}
            className={`h-9 rounded-full border px-4 text-sm ${sub === s.id ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`}>{s.label}</button>
        ))}
      </div>
      <div className={sub === "photo" ? "space-y-3" : "hidden"}>
        <PhotoPane active={active && sub === "photo"} view={view} prompt={prompt} onPrompt={setPrompt} onShot={setLastPhoto} load={loadPhoto} />
      </div>
      <div className={sub === "video" ? "space-y-3" : "hidden"}>
        <VideoPane view={view} boostView={boostView} lastPhoto={lastPhoto} load={loadVideo} />
      </div>
      {sub === "sprites" && <SpritesScreen active={active} />}
      {sub === "library" && <LibraryPane onReuse={reuse} onAnimate={animate} />}
    </section>
  );
}
