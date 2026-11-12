"use client";
import { useState } from "react";
import type { Block } from "@/lib/blocks";
import { requestJson } from "@/lib/net";
import { lineToText, parseToLines, type Line } from "@/lib/prompt";

/** Save this box's lines under a name, or swap in a saved one. Stored as a cluster (data/clusters), so it also shows in Building blocks. */
export function Recall({ lines, onLoad, what }: { lines: Line[]; onLoad: (lines: Line[]) => void; what: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Block[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One entry per line keeps a weighted run (`1.2::a, b::`) whole.
  const tags = lines.filter((l) => l.enabled).map(lineToText).filter(Boolean);

  async function toggle() {
    setOpen(!open);
    if (open) return;
    const r = await requestJson<{ blocks: Block[] }>("/api/blocks");
    if (r.ok) setSaved(r.data.blocks.filter((b) => b.kind === "cluster"));
  }
  async function save() {
    const r = await requestJson<{ block: Block }>("/api/blocks", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind: "cluster", tags }),
    });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setName("");
    setSaved([...saved.filter((b) => b.id !== r.data.block.id), r.data.block]);
  }

  return (
    <>
      <button type="button" aria-expanded={open} onClick={toggle} className="text-accent hit relative px-1 text-xs">Saved</button>
      {open && (
        <div className="bg-bg border-border order-last basis-full space-y-2 rounded-md border p-2">
          {saved.length ? (
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
              {saved.map((b) => (
                <button key={b.id} type="button" title={b.char.join(", ")} onClick={() => { onLoad(parseToLines(b.char.join(", "))); setOpen(false); }}
                  className="border-border min-h-10 rounded-md border px-3 text-sm">{b.name}</button>
              ))}
            </div>
          ) : <p className="text-muted text-xs">Nothing saved yet.</p>}
          {tags.length > 0 && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Save this ${what} as…`} aria-label={`Name for this ${what}`}
                className="bg-surface border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
              <button type="submit" disabled={!name.trim()} className="text-accent px-2 text-sm disabled:opacity-40">Save</button>
            </form>
          )}
          {error && <p role="alert" className="text-danger text-xs">{error}</p>}
        </div>
      )}
    </>
  );
}
