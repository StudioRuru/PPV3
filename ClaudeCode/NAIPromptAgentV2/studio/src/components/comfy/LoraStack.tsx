"use client";
import { useState } from "react";
import type { Lora } from "@/lib/comfy/recipe";
import { TrainLora } from "./TrainLora";

/** Uploads one LoRA with progress (XHR: fetch can't report upload progress). */
function upload(f: File, onPct: (n: number) => void): Promise<{ name: string; pushed: boolean }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `/api/comfy/loras?name=${encodeURIComponent(f.name)}`);
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let r: { name?: string; pushed?: boolean; error?: string } = {};
      try { r = JSON.parse(x.responseText); } catch {}
      if (x.status === 200 && r.name) resolve({ name: r.name, pushed: !!r.pushed }); else reject(new Error(r.error ?? `Upload failed (${x.status}).`));
    };
    x.onerror = () => reject(new Error("Upload failed — check the connection."));
    x.send(f);
  });
}

/** LoRA tool: one −2…2 slider per picked LoRA, then the pod's remaining LoRAs to add, plus Import from Files. */
export function LoraStack({ loras, available, onChange }: { loras: Lora[]; available: string[] | null; onChange: (l: Lora[]) => void }) {
  const left = (available ?? []).filter((n) => !loras.some((l) => l.name === n));
  const [note, setNote] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const importFile = async (f: File) => {
    setNote(null); setPct(0);
    try {
      const r = await upload(f, setPct);
      if (r.pushed && loras.length < 10 && !loras.some((l) => l.name === r.name)) onChange([...loras, { name: r.name, strength: 0.8 }]);
      setNote(r.pushed ? `${r.name} is on the GPU.` : `${r.name} saved — it goes to the GPU when the main pod next starts.`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Upload failed."); }
    setPct(null);
  };
  return (
    <div className="space-y-3">
      {loras.map((l, i) => (
        <div key={l.name} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm">{l.name.replace(/\.safetensors$/, "")}</span>
            <span className="text-muted w-12 text-right font-mono text-xs">{l.strength.toFixed(2)}</span>
            <button type="button" aria-label={`Remove ${l.name}`} onClick={() => onChange(loras.filter((_, j) => j !== i))}
              className="border-border text-muted size-11 rounded-full border text-lg">×</button>
          </div>
          <input type="range" min={-2} max={2} step={0.05} value={l.strength} aria-label={`${l.name} strength`} className="accent-accent h-8 w-full"
            onChange={(e) => onChange(loras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)))} />
        </div>
      ))}
      {available === null ? <p className="text-muted text-sm">Waiting for GPU…</p>
        : loras.length >= 10 ? <p className="text-muted text-sm">10 LoRAs is the limit.</p>
        : !left.length ? <p className="text-muted text-sm">{available.length ? "All LoRAs are in the stack." : "No LoRAs on the GPU."}</p>
        : (
          <div className="flex flex-wrap gap-2">
            {left.map((n) => (
              <button key={n} type="button" onClick={() => onChange([...loras, { name: n, strength: 0.8 }])}
                className="border-border min-h-11 rounded-full border px-3 text-xs">+ {n.replace(/\.safetensors$/, "")}</button>
            ))}
          </div>
        )}
      {/* No accept filter: iOS doesn't know .safetensors and would grey every file out. */}
      <label className={`border-border flex min-h-11 items-center justify-center rounded-full border border-dashed px-3 text-xs ${pct === null ? "cursor-pointer" : "opacity-60"}`}>
        {pct === null ? "Import LoRA from Files (.safetensors)" : `Uploading… ${pct}%`}
        <input type="file" className="sr-only" disabled={pct !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
      </label>
      {note && <p className="text-muted text-xs" role="status">{note}</p>}
      <TrainLora />
    </div>
  );
}
