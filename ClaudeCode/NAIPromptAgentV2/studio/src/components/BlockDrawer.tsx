"use client";
import { useEffect, useState } from "react";
import type { Block } from "@/lib/blocks";
import { requestJson } from "@/lib/net";
import type { CharBox, Rating } from "@/lib/prompt";
import { BUILTIN_PRESETS, type Preset } from "@/lib/tagger";
import { Sheet } from "./Sheet";

// Character colours are theme tokens (globals.css): pastel on dark themes, deeper on Daylight for contrast.
export const DOT = ["var(--dot-0)", "var(--dot-1)", "var(--dot-2)", "var(--dot-3)"];

export function BlockDrawer({ open, onClose, chars, tagText, onSend, onLoadScene, preset, onPreset, rating }: {
  open: boolean; onClose: () => void; chars: CharBox[]; tagText: string;
  onSend: (picked: Block[], target: "base" | number) => void; onLoadScene: (b: Block) => void;
  preset: Preset; onPreset: (p: Preset) => void; rating: Rating;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [presets, setPresets] = useState<Preset[]>(BUILTIN_PRESETS);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<"base" | number>(chars.length ? 0 : "base");
  const [q, setQ] = useState("");
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Block[] | string | null>(null); // string = why suggestions failed

  useEffect(() => {
    if (!open) return;
    // Default target is chosen on each open: the drawer mounts before the saved draft's characters load.
    setTarget(chars.length ? 0 : "base");
    requestJson<{ blocks: Block[] }>("/api/blocks").then((r) => r.ok && setBlocks(r.data.blocks));
    requestJson<{ presets: Preset[] }>("/api/presets").then((r) => r.ok && setPresets(r.data.presets));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the drawer opens
  }, [open]);

  // Own effect: the drawer opens in the same commit the tagger result lands, before tagText reaches us.
  useEffect(() => {
    if (!open || !tagText) return;
    let stale = false;
    setSuggested(null);
    requestJson<{ tags: string[] }>("/api/expand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: tagText, rating }) })
      .then((r) => !stale && setSuggested(r.ok ? r.data.tags.map((t) => ({ id: `sg:${t}`, kind: "cluster" as const, name: t, base: [], char: [t], uc: [], user: false })) : r.error));
    return () => { stale = true; };
  }, [open, tagText, rating]);

  const match = (b: Block) => !q || `${b.name} ${b.char.join(" ")}`.toLowerCase().includes(q.toLowerCase());
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]));
  const chosen = [...blocks, ...(Array.isArray(suggested) ? suggested : [])].filter((b) => picked.includes(b.id));
  const count = (tagText ? tagText.split(", ").length : 0) + chosen.reduce((n, b) => n + b.char.length + b.base.length, 0);

  async function saveCluster() {
    const r = await requestJson<{ block: Block }>("/api/blocks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: saveName, kind: "cluster", tags: tagText.split(", ").filter(Boolean) }),
    });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setSaveName("");
    setBlocks([...blocks.filter((b) => b.id !== r.data.block.id), r.data.block]);
  }

  const card = (b: Block) => (
    <button key={b.id} type="button" aria-pressed={picked.includes(b.id)} onClick={() => toggle(b.id)}
      className={`rounded-lg border p-2.5 text-left ${picked.includes(b.id) ? "border-accent bg-surface-2" : "border-border bg-bg"}`}>
      <div className="text-sm font-semibold">{b.name}</div>
      <div className="text-muted mt-0.5 truncate text-xs">{[...b.base, ...b.char].slice(0, 4).join(", ")} · {b.base.length + b.char.length}</div>
    </button>
  );
  const section = (title: string, children: React.ReactNode) => (
    <div><h3 className="text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">{title}</h3>{children}</div>
  );

  return (
    <Sheet open={open} onClose={onClose} label="Add to this scene" closeLabel="Close drawer"
      className="max-h-[85dvh] rounded-t-2xl border-t lg:max-h-none lg:w-[420px] lg:rounded-none lg:border-l">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h2 className="font-semibold">Add to this scene</h2>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks" aria-label="Search blocks"
            className="bg-bg border-border ml-auto w-36 rounded-md border px-2 py-1.5 text-base" />
          <button type="button" onClick={onClose} aria-label="Close" className="border-border size-11 rounded-md border">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4">
          {section("Tagger presets", (
            <div role="radiogroup" aria-label="Tagger preset" className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={preset.id === p.id} onClick={() => onPreset(p)}
                  className={`rounded-full px-3 py-2 text-sm ${preset.id === p.id ? "bg-accent text-accent-fg font-semibold" : "border-border border"}`}>{p.name}</button>
              ))}
            </div>
          ))}
          {section("Theme groups", <div className="grid grid-cols-2 gap-2">{blocks.filter((b) => b.kind === "theme" && match(b)).map(card)}</div>)}
          {section("My clusters", (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">{blocks.filter((b) => b.kind === "cluster" && match(b)).map(card)}</div>
              {tagText && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveCluster(); }}>
                  <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Save current tags as…" aria-label="Cluster name"
                    className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2 text-base" />
                  <button type="submit" disabled={!saveName.trim()} className="text-accent px-2 text-sm disabled:opacity-40">Save</button>
                </form>
              )}
              {error && <p role="alert" className="text-danger text-sm">{error}</p>}
            </div>
          ))}
          {section("Library", (
            <div className="space-y-1.5">
              {blocks.filter((b) => (b.kind === "outfit" || b.kind === "scene") && match(b)).map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <div className="flex-1">{card(b)}</div>
                  {b.kind === "scene" && <button type="button" onClick={() => onLoadScene(b)} className="text-accent px-2 py-2 text-sm">Load</button>}
                </div>
              ))}
            </div>
          ))}
          {section("Suggested for this image", !tagText ? <p className="text-muted text-sm">Tag an image to get suggestions.</p>
            : suggested === null ? <p className="text-muted sweep rounded-md px-1 text-sm">Thinking…</p>
            : typeof suggested === "string" ? <p className="text-muted text-sm">{suggested}</p>
            : <div className="flex flex-wrap gap-1.5">{suggested.map((b, i) => (
                <button key={b.id} type="button" aria-pressed={picked.includes(b.id)} onClick={() => toggle(b.id)} style={{ animationDelay: `${Math.min(i, 16) * 35}ms` }}
                  className={`animate-rise h-9 rounded-md border px-3 text-sm ${picked.includes(b.id) ? "border-accent bg-surface-2" : "border-cyan/40 bg-cyan/10"}`}>+ {b.name}</button>))}</div>)}
        </div>

        <div className="border-border flex gap-2 border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <select aria-label="Send to" value={String(target)} onChange={(e) => setTarget(e.target.value === "base" ? "base" : Number(e.target.value))}
            className="bg-bg border-border rounded-md border px-2 py-3 text-base">
            <option value="base">Base</option>
            {chars.map((c, i) => <option key={c.id} value={i}>Character {i + 1}</option>)}
          </select>
          {typeof target === "number" && <span key={target} aria-hidden="true" className="dot-settle my-auto size-3 rounded-full" style={{ background: DOT[target % DOT.length] }} />}
          <button type="button" disabled={!count} onClick={() => { onSend(chosen, target); setPicked([]); onClose(); }}
            className="bg-accent text-accent-fg ml-auto flex-1 rounded-lg px-4 py-3 font-semibold disabled:opacity-40">Send <span key={count} className="animate-rise inline-block tabular-nums">{count}</span> tags</button>
        </div>
    </Sheet>
  );
}
