"use client";
import type { VideoRecipe } from "@/lib/comfy/recipe";

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? "bg-accent text-accent-fg border-accent font-semibold" : "border-border text-muted"}`;

/** Motion tool: length, motion strength, smoothness, seamless loop, end frame and size. */
export function MotionSheet({ r, onChange, onPickEnd, endSet }: {
  r: VideoRecipe; onChange: (patch: Partial<VideoRecipe>) => void; onPickEnd: () => void; endSet: boolean;
}) {
  return (
    <div className="space-y-3 text-sm">
      <label className="block">Length {r.seconds} s
        <input type="range" min={1} max={10} step={1} className="accent-accent h-8 w-full" value={r.seconds} onChange={(e) => onChange({ seconds: Number(e.target.value) })} />
      </label>
      <div role="group" aria-label="Motion" className="flex flex-wrap items-center gap-2"><span className="w-16">Motion</span>
        {(["low", "medium", "high"] as const).map((m) => <button key={m} type="button" aria-pressed={r.motion === m} onClick={() => onChange({ motion: m })} className={chip(r.motion === m)}>{m}</button>)}
      </div>
      <div role="group" aria-label="Smooth to" className="flex flex-wrap items-center gap-2"><span className="w-16">Smooth to</span>
        {([16, 30, 60] as const).map((f) => <button key={f} type="button" aria-pressed={r.fps === f} onClick={() => onChange({ fps: f })} className={chip(r.fps === f)}>{f} fps</button>)}
      </div>
      <div role="group" aria-label="Size" className="flex flex-wrap items-center gap-2"><span className="w-16">Size</span>
        {(["480p", "720p"] as const).map((s) => <button key={s} type="button" aria-pressed={r.size === s} onClick={() => onChange({ size: s })} className={chip(r.size === s)}>{s}</button>)}
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="accent-accent size-5" checked={r.mode === "loop"} disabled={r.mode === "t2v" || r.mode === "extend"}
          onChange={(e) => onChange({ mode: e.target.checked ? "loop" : "animate" })} />
        Seamless loop
      </label>
      {r.mode === "animate" && (
        <div role="group" aria-label="End frame" className="flex flex-wrap items-center gap-2"><span className="w-16">End frame</span>
          <button type="button" aria-pressed={!endSet} onClick={() => onChange({ end: null })} className={chip(!endSet)}>Same as start</button>
          <button type="button" aria-pressed={endSet} onClick={onPickEnd} className={chip(endSet)}>{endSet ? "Picked ✓" : "Pick…"}</button>
        </div>
      )}
    </div>
  );
}
