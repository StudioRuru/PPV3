"use client";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/lib/net";

// "moss" = POSE_FAMILY (train.ts is server-only, so not imported here)
const post = (body: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const btn = "border-border h-11 rounded-full border px-4 text-sm disabled:opacity-50";
type Data = { renders: { i: number; picked: boolean }[]; spent: number };

/** Sprites → Training set: render NovelAI shots of Miyabi, tap 5–40, train the pose + Wan LoRAs from them. */
export function TrainSet() {
  const [d, setD] = useState<Data>({ renders: [], spent: 0 });
  const [per, setPer] = useState<number | null>(null); // measured Anlas per render, from the price check
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => { const r = await requestJson<Data>("/api/sprites/trainset"); if (r.ok) setD(r.data); }, []);
  useEffect(() => {
    void load();
    const poll = () => requestJson<{ main: { phase: string } }>("/api/comfy/engine").then((r) => setReady(r.ok && r.data.main.phase === "ready"));
    void poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [load]);

  const render = async (n: number) => {
    setBusy(true); setMsg(null);
    const r = await requestJson<{ made: number; spent: number; error?: string }>("/api/sprites/trainset", post({ n }));
    if (!r.ok) setMsg(r.error);
    else {
      if (per == null && r.data.made) setPer(r.data.spent - d.spent);
      setMsg(r.data.error ?? `Rendered ${r.data.made}.`);
    }
    setBusy(false); await load();
  };
  const toggle = async (i: number, on: boolean) => {
    setD((x) => ({ ...x, renders: x.renders.map((r) => (r.i === i ? { ...r, picked: on } : r)) }));
    await requestJson("/api/sprites/trainset", post({ pick: i, on }));
  };
  const train = async (name: string, arch: string) => {
    setBusy(true); setMsg(null);
    const r = await requestJson("/api/comfy/train", post({ trainset: true, name, arch, kind: "face" }));
    setMsg(r.ok ? `Training ${name} started.` : r.error);
    setBusy(false);
  };
  const picks = d.renders.filter((r) => r.picked).length;
  const canTrain = !busy && ready && picks >= 5 && picks <= 40;
  return (
    <div className="border-border bg-surface space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => render(1)} className={btn}>Render 1 (price check)</button>
        <button type="button" disabled={busy || per == null} onClick={() => render(89)} className={btn}>Render the rest</button>
        <span className="text-muted text-sm">{per == null ? "Run the price check first." : `${per} Anlas each, about ${Math.round(per * 90)} for 90.`} Spent {d.spent}.</span>
      </div>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-10">
        {d.renders.map((r) => (
          // eslint-disable-next-line @next/next/no-img-element
          <button key={r.i} type="button" aria-pressed={r.picked} aria-label={`Render ${r.i}`} onClick={() => toggle(r.i, !r.picked)} className={`overflow-hidden rounded border-2 ${r.picked ? "border-accent" : "border-transparent"}`}>
            <img src={`/api/sprites/trainset/${r.i}`} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{picks}/40 picked (5 minimum)</span>
        <button type="button" disabled={!canTrain} onClick={() => train("miyabi_sprite_img", "moss")} className={btn}>Train image LoRA</button>
        <button type="button" disabled={!canTrain} onClick={() => train("miyabi_sprite_wan", "wan22")} className={btn}>Train Wan LoRA</button>
        {!ready && <span className="text-muted text-sm">Start the GPU to train.</span>}
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}
