"use client";
import { useState } from "react";
import type { PhotoRecipe } from "@/lib/comfy/recipe";
import { CHIPS, safePatch, type Suggestion } from "@/lib/comfy/tuning";
import { requestJson } from "@/lib/net";

type Turn = { said: string } & Suggestion;

/** Miyabi's Photo copilot: a chip or a typed complaint becomes a suggested tweak; Apply edits the recipe, never renders. */
export function CopilotPanel({ recipe, onApply }: { recipe: PhotoRecipe; onApply: (p: Partial<PhotoRecipe>) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask(body: { chip?: string; text?: string }, said: string) {
    setBusy(true); setErr(null);
    const res = await requestJson<Suggestion>("/api/comfy/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, recipe }) });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setTurns((t) => [...t, { said, ...res.data }].slice(-6));
  }
  const last = turns.at(-1);
  return (
    <div className="border-border flex h-full min-h-0 flex-col gap-2 rounded-lg border p-3">
      <p className="text-faint text-xs font-semibold uppercase tracking-wide">Miyabi</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What went wrong">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" disabled={busy} onClick={() => void ask({ chip: c.id }, c.label)} className="border-border text-muted min-h-9 rounded-full border px-3 text-xs disabled:opacity-50">{c.label}</button>
        ))}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder="Tell Miyabi what's off…" aria-label="Tell Miyabi what's off"
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim() && !busy) { const t = text.trim(); setText(""); void ask({ text: t }, t); } }}
        className="bg-surface border-border w-full rounded-lg border p-2 text-sm" />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {err && <p role="alert" className="text-xs text-red-500">{err}</p>}
        {busy && <p className="text-muted text-xs">Miyabi is thinking…</p>}
        {turns.slice(0, -1).map((t, i) => <p key={i} className="text-faint text-xs"><b>{t.said}</b> — {t.say}</p>)}
        {last && (
          <div className="bg-surface border-border space-y-2 rounded-lg border p-2 text-sm">
            <p className="text-faint text-xs">{last.said}</p>
            <p>{last.say}</p>
            {Object.keys(last.patch).length > 0 && (
              <button type="button" onClick={() => onApply(safePatch(recipe, last.patch))} className="bg-accent text-accent-fg min-h-9 rounded-full px-4 text-sm font-semibold">Apply</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
