"use client";
import { useEffect, useRef, useState } from "react";
import { type Kp, LIMBS, mirror } from "@/lib/comfy/pose";
import type { PoseRef } from "@/lib/comfy/recipe";
import { requestJson } from "@/lib/net";

export type PoseState = {
  kind: PoseRef["kind"]; strength: number; refUrl: string | null; extracted: string | null;
  kp: Kp[] | null; orig: Kp[] | null; busy: boolean; error: string | null;
};
export const EMPTY_POSE: PoseState = { kind: "pose", strength: 1, refUrl: null, extracted: null, kp: null, orig: null, busy: false, error: null };
const KINDS: [PoseRef["kind"], string][] = [["pose", "Copy pose"], ["depth", "Depth"], ["lineart", "Outline"]];
const JOINT = LIMBS.reduce<string[]>((c, [, b, col]) => ((c[b] = col), c), Array(18).fill("#fff"));

/** Any image blob → ≤1536 px JPEG data URL (keeps phone photos well under the 20 MB upload cap). */
export async function toDataUrl(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 1536 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

/** The edited skeleton as an OpenPose-style PNG (black canvas, coloured limbs) at the recipe size. */
export function renderSkeleton(kp: Kp[], w: number, h: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  g.lineCap = "round";
  g.lineWidth = Math.max(4, Math.round(w / 100));
  for (const [a, b, col] of LIMBS) {
    if (!kp[a]?.[2] || !kp[b]?.[2]) continue;
    g.strokeStyle = col;
    g.beginPath();
    g.moveTo(kp[a][0] * w, kp[a][1] * h);
    g.lineTo(kp[b][0] * w, kp[b][1] * h);
    g.stroke();
  }
  kp.forEach(([x, y, conf], i) => {
    if (!conf) return;
    g.fillStyle = JOINT[i];
    g.beginPath();
    g.arc(x * w, y * h, g.lineWidth * 0.9, 0, Math.PI * 2);
    g.fill();
  });
  return c.toDataURL("image/png");
}

/** Skeleton drawn over the canvas; each joint is a 44 px touch target dragged with pointer events. Fill a `relative` parent. */
export function PoseOverlay({ kp, onMove }: { kp: Kp[]; onMove: (i: number, x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };
  return (
    <div ref={box} className="absolute inset-0 touch-none select-none" style={{ touchAction: "none" }}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
        {LIMBS.map(([a, b, col]) => kp[a][2] && kp[b][2] ? (
          <line key={`${a}-${b}`} x1={kp[a][0]} y1={kp[a][1]} x2={kp[b][0]} y2={kp[b][1]} stroke={col} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        ) : null)}
      </svg>
      {kp.map(([x, y, c], i) => c ? (
        <div key={i} role="slider" aria-label={`Joint ${i}`} aria-valuenow={Math.round(x * 100)} data-joint={i}
          className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, touchAction: "none" }}
          onPointerDown={(e) => { drag.current = i; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
          onPointerMove={(e) => { if (drag.current === i) onMove(i, ...at(e)); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <span className="size-3.5 rounded-full border border-black/60" style={{ background: JOINT[i] }} />
        </div>
      ) : null)}
    </div>
  );
}

type Saved = { id: number; name: string; keypoints: number[] };
type LibItem = { id: number; kind: string; file: string };
const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-xs ${on ? "bg-accent text-accent-fg border-accent" : "border-border text-muted"}`;

/** Pose tool: pick a reference, choose what to copy, extract, then edit/save the skeleton. */
export function PoseTool({ st, set, onExtract, onClear }: {
  st: PoseState; set: (p: Partial<PoseState>) => void; onExtract: () => void; onClear: () => void;
}) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [items, setItems] = useState<LibItem[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const loadSaved = () => requestJson<{ poses: Saved[] }>("/api/comfy/poses").then((r) => r.ok && setSaved(r.data.poses));
  useEffect(() => {
    loadSaved();
    requestJson<{ items: LibItem[] }>("/api/comfy/items").then((r) => r.ok && setItems(r.data.items.filter((i) => i.kind === "photo")));
  }, []);

  const useBlob = async (b: Blob) => {
    try { set({ refUrl: await toDataUrl(b), extracted: null, error: null }); } catch { set({ error: "Couldn't read that image." }); }
  };
  const pickItem = async (file: string) => {
    try { await useBlob(await (await fetch(`/api/comfy/file/${file}`)).blob()); } catch { set({ error: "Couldn't load that image." }); }
  };
  const save = async () => {
    const n = (name ?? "").trim();
    if (!n || !st.kp) return;
    const r = await requestJson("/api/comfy/poses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, keypoints: st.kp.flat() }) });
    setMsg(r.ok ? `Saved “${n}”.` : r.error);
    if (r.ok) { setName(null); loadSaved(); }
  };
  const load = (p: Saved) => {
    const kp = Array.from({ length: 18 }, (_, i) => [p.keypoints[i * 3] ?? 0, p.keypoints[i * 3 + 1] ?? 0, p.keypoints[i * 3 + 2] ?? 0] as Kp);
    set({ kind: "pose", kp, orig: kp, error: null });
  };
  const ready = st.kind === "pose" ? !!st.kp : !!st.extracted;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="border-border grid min-h-11 cursor-pointer place-items-center rounded-full border px-3 text-xs">
          Choose a photo
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void useBlob(f); e.target.value = ""; }} />
        </label>
        {st.refUrl && <img src={st.refUrl} alt="Reference" className="size-11 rounded object-cover" />}
      </div>
      {items.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" aria-label="Library photos">
          {items.slice(0, 12).map((i) => (
            <button key={i.id} type="button" aria-label={`Use Library photo ${i.id}`} onClick={() => void pickItem(i.file)} className="size-11 shrink-0 overflow-hidden rounded">
              <img src={`/api/comfy/file/${i.file}`} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, label]) => <button key={k} type="button" aria-pressed={st.kind === k} onClick={() => set({ kind: k, extracted: null, kp: null, orig: null })} className={chip(st.kind === k)}>{label}</button>)}
        <button type="button" disabled={!st.refUrl || st.busy} onClick={onExtract} className="bg-accent text-accent-fg min-h-11 rounded-full px-4 text-xs font-semibold disabled:opacity-50">{st.busy ? "Reading…" : "Extract"}</button>
        {(ready || st.refUrl) && <button type="button" onClick={() => { onClear(); setMsg(null); }} className="text-muted min-h-11 px-2 text-xs">Clear</button>}
      </div>
      {st.error && <p role="alert" className="text-danger">{st.error}</p>}
      {ready && (
        <label className="block">Strength {st.strength.toFixed(2)}
          <input type="range" min={0} max={2} step={0.05} className="accent-accent h-8 w-full" value={st.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
        </label>
      )}
      {st.kind === "pose" && st.kp && (
        <div className="space-y-2">
          <p className="text-muted text-xs">Drag the joints on the canvas to change the pose.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => set({ kp: mirror(st.kp!) })} className={chip(false)}>Mirror</button>
            <button type="button" disabled={!st.orig} onClick={() => set({ kp: st.orig })} className={`${chip(false)} disabled:opacity-50`}>Reset</button>
            {name === null
              ? <button type="button" onClick={() => { setName(""); setMsg(null); }} className={chip(false)}>Save pose</button>
              : (
                <>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Pose name" aria-label="Pose name"
                    className="bg-bg border-border h-11 min-w-0 flex-1 rounded-md border px-2 text-base" />
                  <button type="button" disabled={!name.trim()} onClick={() => void save()} className="bg-accent text-accent-fg min-h-11 rounded-full px-4 text-xs font-semibold disabled:opacity-50">Save</button>
                </>
              )}
          </div>
        </div>
      )}
      {st.kind !== "pose" && st.extracted && <p className="text-muted text-xs">Used as extracted — {st.kind === "depth" ? "depth maps" : "outlines"} can&apos;t be edited.</p>}
      {msg && <p role="status" className="text-muted text-xs">{msg}</p>}
      {saved.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" aria-label="Saved poses">
          {saved.map((p) => <button key={p.id} type="button" onClick={() => load(p)} className={`${chip(false)} shrink-0`}>{p.name}</button>)}
        </div>
      )}
    </div>
  );
}
