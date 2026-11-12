"use client";
import { useState } from "react";
import { interact, layout, newLine, positionWords, regionOf, type CharBox, type Layout, type Positions } from "@/lib/prompt";
import { DOT } from "./BlockDrawer";
import { LineList } from "./LineList";
import { AutoTextarea } from "./TagInput";
import { Trash } from "./icons";
import { PosNegTabs, tagCount, type Side } from "./PosNegTabs";
import { PositionCanvas } from "./PositionCanvas";
import { Recall } from "./Recall";

const LAYOUTS: [Layout, string][] = [["row", "Side by side"], ["close", "Close together"], ["front", "Front & back"], ["stack", "Top & bottom"]];
// Common two-person Danbooru actions; anything typed works.
const ACTIONS = ["hug", "kiss", "holding hands", "headpat", "hand on another's shoulder", "hand on another's cheek", "hand on another's head",
  "arm around shoulder", "looking at another", "pointing at another", "feeding", "carrying", "princess carry", "piggyback", "lap pillow",
  "hair brushing", "hand on another's waist", "grabbing another's hair", "slapping", "punching", "pushing", "pulling", "licking", "biting", "leaning on person"];

export function CharacterBoxes({ chars, onChange, positions, onPositions, width, height, words, onWords }: {
  chars: CharBox[]; onChange: (c: CharBox[]) => void;
  positions: Positions; onPositions: (p: Positions) => void; width: number; height: number;
  words: boolean; onWords: (on: boolean) => void;
}) {
  const [sides, setSides] = useState<Record<string, Side>>({});
  const [act, setAct] = useState({ from: 0, to: 1, action: "", mutual: false });
  const set = (i: number, patch: Partial<CharBox>) => onChange(chars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {chars.map((c, i) => (
        <section key={c.id} data-drop={`char:${i}`} style={{ "--dot": DOT[i % DOT.length] } as React.CSSProperties} className="bg-surface border-border rounded-lg border p-3">
          <header className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={c.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: DOT[i % DOT.length] }} />
              Character {i + 1}
            </label>
            <PosNegTabs side={sides[c.id] ?? "pos"} onSide={(s) => setSides({ ...sides, [c.id]: s })}
              pos={c.lines.reduce((n, l) => n + tagCount(l.text), 0)} neg={tagCount(c.uc)} />
            <Recall lines={c.lines} onLoad={(lines) => set(i, { lines })} what="character" />
            <button type="button" aria-label={`Delete character ${i + 1}`} className="text-faint hover:text-danger grid size-9 place-items-center"
              onClick={() => onChange(chars.filter((_, j) => j !== i))}><Trash /></button>
          </header>
          {(sides[c.id] ?? "pos") === "pos"
            ? <LineList lines={c.lines} onChange={(lines) => set(i, { lines })} />
            : <AutoTextarea value={c.uc} onChange={(uc) => set(i, { uc })} placeholder="what this character should not have" />}
        </section>
      ))}
      {chars.length < 22 && (
        <button type="button" className="text-accent text-sm"
          onClick={() => onChange([...chars, { id: newLine().id, lines: [newLine("girl")], uc: "", enabled: true }])}>
          + character
        </button>
      )}
      {chars.length > 0 && (
        <section className="bg-surface border-border space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Position</span>
            <div role="radiogroup" aria-label="Character positions" className="border-border flex overflow-hidden rounded-md border">
              {([["ai", "AI decides"], ["custom", "Custom"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={positions === v} onClick={() => onPositions(v)}
                  className={`px-3 py-2 ${positions === v ? "bg-accent text-accent-fg" : ""}`}>{label}</button>
              ))}
            </div>
          </div>
          {positions === "custom" && <>
            <div className="flex flex-wrap justify-center gap-1.5">
              {LAYOUTS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => { const r = layout(k, chars.length); onChange(chars.map((c, i) => ({ ...c, region: r[i], center: { x: r[i].x, y: r[i].y } }))); }}
                  className="border-border min-h-10 rounded-full border px-3 text-xs">{label}</button>
              ))}
            </div>
            <PositionCanvas chars={chars} width={width} height={height} onChange={onChange} words={words} />
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span>Position words<span className="text-muted block text-xs">Adds where each box is to its prompt — stronger placement</span></span>
              <input type="checkbox" role="switch" checked={words} onChange={(e) => onWords(e.target.checked)} className="accent-accent size-5" />
            </label>
            {words && (
              <ul className="space-y-0.5 font-mono text-[11px]">
                {chars.map((c, i) => c.enabled && (
                  <li key={c.id} className="text-muted flex gap-2"><span style={{ color: DOT[i % DOT.length] }}>{i + 1}</span>{positionWords(regionOf(c, i, chars.length))}</li>
                ))}
              </ul>
            )}
          </>}
        </section>
      )}
      {chars.length > 1 && (() => {
        const pick = (key: "from" | "to") => (
          <select aria-label={key === "from" ? "Who does it" : "Who receives it"} value={Math.min(act[key], chars.length - 1)}
            onChange={(e) => setAct({ ...act, [key]: Number(e.target.value) })} className="bg-bg border-border min-h-11 rounded-md border px-2 text-base">
            {chars.map((c, i) => <option key={c.id} value={i}>{i + 1}</option>)}
          </select>
        );
        const from = Math.min(act.from, chars.length - 1), to = Math.min(act.to, chars.length - 1);
        return (
          <form className="bg-surface border-border space-y-2 rounded-lg border p-3" onSubmit={(e) => {
            e.preventDefault();
            onChange(interact(chars, from, to, act.action, act.mutual));
            setAct({ ...act, action: "" });
          }}>
            <div className="text-sm font-semibold">Interaction<span className="text-muted block text-xs font-normal">Adds source#/target# (or mutual#) to both boxes</span></div>
            <div className="flex items-center gap-2">
              {pick("from")}
              <button type="button" aria-label={act.mutual ? "Both do it (mutual) — tap for one-way" : "One-way — tap for mutual"} aria-pressed={act.mutual}
                onClick={() => setAct({ ...act, mutual: !act.mutual })} className="border-border min-h-11 w-11 rounded-md border text-lg">{act.mutual ? "↔" : "→"}</button>
              {pick("to")}
              <input list="interaction-actions" value={act.action} onChange={(e) => setAct({ ...act, action: e.target.value })}
                placeholder="hug, kiss…" aria-label="Action" className="bg-bg border-border min-h-11 min-w-0 flex-1 rounded-md border px-2 text-base" />
              <datalist id="interaction-actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
            <button type="submit" disabled={!act.action.trim() || from === to}
              className="bg-accent text-accent-fg min-h-11 w-full rounded-md px-3 text-sm font-semibold disabled:opacity-40">
              {from === to ? "Pick two different characters" : act.mutual ? `${from + 1} ↔ ${to + 1} together` : `${from + 1} does it to ${to + 1}`}
            </button>
          </form>
        );
      })()}
    </div>
  );
}
