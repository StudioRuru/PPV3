"use client";
import { useEffect, useRef, useState } from "react";
import type { EngineView } from "@/lib/comfy/engine";
import { requestJson } from "@/lib/net";
import { Drawer } from "./Drawer";
import { PhotoPane } from "./PhotoPane";
import { GpuLine, type EngineAction } from "./GpuLine";

type Sub = "photo" | "video" | "library";
const SUBS: { id: Sub; label: string }[] = [{ id: "photo", label: "Photo" }, { id: "video", label: "Video" }, { id: "library", label: "Library" }];
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** ComfyUI tab: GPU status line + sub-tabs. Opening the tab pre-warms the GPU once; the prompt and drawer work whatever the GPU is doing. */
export function ComfyScreen({ active }: { active: boolean }) {
  const [sub, setSub] = useState<Sub>("photo");
  const [view, setView] = useState<EngineView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const warmed = useRef(false);

  // Errors from warm/actions stay until the next action succeeds; a poll only clears (or sets) its own error.
  const pollErr = useRef(false);
  const apply = (r: Awaited<ReturnType<typeof requestJson<EngineView | { main: EngineView }>>>, from: "poll" | "action" = "action") => {
    if (!r.ok) { setError(r.error); pollErr.current = from === "poll"; return; }
    if (from === "action" || pollErr.current) { setError(null); pollErr.current = false; }
    setView("main" in r.data ? r.data.main : r.data);
  };

  useEffect(() => {
    if (!active) return;
    if (!warmed.current) { warmed.current = true; requestJson<EngineView>("/api/comfy/engine", post({ action: "warm" })).then(apply); }
    const poll = () => requestJson<{ main: EngineView }>("/api/comfy/engine").then((r) => apply(r, "poll"));
    poll();
    const p = setInterval(poll, 5000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(p); clearInterval(t); };
  }, [active]);

  const act = (a: EngineAction) => requestJson<EngineView>("/api/comfy/engine", post(a)).then((r) => {
    if (!r.ok) { setError(r.error); pollErr.current = false; }
    else { setError(null); pollErr.current = false; requestJson<{ main: EngineView }>("/api/comfy/engine").then((q) => apply(q, "poll")); }
  });

  return (
    <section className="space-y-3 pb-[calc(env(safe-area-inset-bottom)+14rem)]">
      <h1 className="text-[15px] font-semibold tracking-wide">ComfyUI</h1>
      <GpuLine view={view} now={now} onAction={act} error={error} />
      <div role="tablist" aria-label="ComfyUI sections" className="flex gap-2">
        {SUBS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={sub === s.id} onClick={() => setSub(s.id)}
            className={`h-9 rounded-full border px-4 text-sm ${sub === s.id ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`}>{s.label}</button>
        ))}
        <button type="button" role="tab" disabled aria-selected={false} className="border-border text-faint h-9 rounded-full border px-4 text-sm opacity-60">Sprites — soon</button>
      </div>
      <div className={sub === "photo" ? "space-y-3" : "hidden"}>
        <PhotoPane active={active && sub === "photo"} view={view} prompt={prompt} onPrompt={setPrompt} />
      </div>
      {sub !== "photo" && (
        <>
          <div className="border-border text-muted grid min-h-48 place-items-center rounded-lg border p-6 text-center text-sm">
            {sub === "library" ? "Your photos and clips will appear here." : "Video tools are coming — the prompt below is ready."}
          </div>
          <Drawer prompt={prompt} onPrompt={setPrompt} placeholder={sub === "video" ? "Describe the motion…" : "Describe the picture…"}
            action={sub === "video" ? "Make clip" : "Make photo"} onAction={() => {}} disabled={!prompt.trim()} />
        </>
      )}
    </section>
  );
}
