"use client";
import { useEffect, useState } from "react";

type Run = { name: string; arch: "sdxl" | "qwen"; progress: number; done?: boolean; error?: string; startedAt: number };
const EST = { sdxl: "~30 min, about $0.60", qwen: "~75 min, about $1.30" } as const;

/** Train a LoRA on the main pod from 5–40 photos. The run continues server-side; this only starts it and shows progress. */
export function TrainLora() {
  const [run, setRun] = useState<Run | null>(null);
  const [name, setName] = useState("");
  const [arch, setArch] = useState<"sdxl" | "qwen">("sdxl");
  const [kind, setKind] = useState<"face" | "scene">("face");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = !!run && !run.done && !run.error;

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const r = await fetch("/api/comfy/train").then((x) => x.json()).catch(() => null);
      if (!stop && r?.run !== undefined) setRun(r.run);
    };
    void poll();
    const t = setInterval(poll, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const start = async () => {
    setBusy(true); setNote(null);
    const f = new FormData();
    f.set("name", name); f.set("arch", arch); f.set("kind", kind);
    files.forEach((x) => f.append("images", x));
    const r = await fetch("/api/comfy/train", { method: "POST", body: f }).then((x) => x.json()).catch(() => ({ error: "Upload failed — check the connection." }));
    if (r.run) { setRun({ ...r.run, progress: 0 }); setFiles([]); } else setNote(r.error ?? "Couldn't start training.");
    setBusy(false);
  };

  const pill = (on: boolean) => `min-h-11 flex-1 rounded-full border px-3 text-xs ${on ? "border-accent text-accent" : "border-border text-muted"}`;
  return (
    <details className="border-border rounded-2xl border p-3">
      <summary className="min-h-11 cursor-pointer text-sm leading-[2.75rem]">Train a LoRA from photos</summary>
      <div className="space-y-3 pt-2">
        {run && (
          <div role="status" className="space-y-1">
            <p className="text-sm">
              {run.done ? `${run.name} is ready — it's in the LoRA list.` : run.error ? `${run.name} failed: ${run.error}` : `Training ${run.name}… ${Math.round(run.progress * 100)}%`}
            </p>
            {active && <div className="bg-border h-2 overflow-hidden rounded-full"><div className="bg-accent h-full" style={{ width: `${Math.max(2, run.progress * 100)}%` }} /></div>}
          </div>
        )}
        {!active && (
          <>
            <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="name (also the trigger word)"
              aria-label="LoRA name" className="border-border min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm" />
            <div className="flex gap-2">
              <button type="button" className={pill(kind === "face")} onClick={() => setKind("face")}>Face</button>
              <button type="button" className={pill(kind === "scene")} onClick={() => setKind("scene")}>Scene / style</button>
            </div>
            <div className="flex gap-2">
              <button type="button" className={pill(arch === "sdxl")} onClick={() => setArch("sdxl")}>SDXL</button>
              <button type="button" className={pill(arch === "qwen")} onClick={() => setArch("qwen")}>Qwen</button>
            </div>
            <label className="border-border flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-dashed px-3 text-xs">
              {files.length ? `${files.length} photos picked` : "Pick 5–40 photos"}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            </label>
            <p className="text-muted text-xs">{kind === "face" ? "Clear, varied shots of one face work best. " : ""}{EST[arch]} on the GPU. Renders wait until it's done.</p>
            <button type="button" disabled={busy || name.length < 3 || files.length < 5 || files.length > 40} onClick={start}
              className="bg-accent text-accent-fg min-h-11 w-full rounded-full text-sm font-semibold disabled:opacity-50">{busy ? "Uploading…" : "Train"}</button>
          </>
        )}
        {note && <p className="text-muted text-xs" role="alert">{note}</p>}
      </div>
    </details>
  );
}
