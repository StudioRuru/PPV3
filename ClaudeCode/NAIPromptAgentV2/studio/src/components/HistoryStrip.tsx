"use client";
import type { NaiParams } from "@/lib/nai-body";
import type { PromptState } from "@/lib/prompt";

export type Generation = { id: number; file: string; seed: number; model: string; state: PromptState; params: NaiParams };

export function HistoryStrip({ items, onOpen }: { items: Generation[]; onOpen: (g: Generation) => void }) {
  if (!items.length) return <p className="text-muted text-sm">No generations yet.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {items.map((g) => (
        <button key={g.id} type="button" onClick={() => onOpen(g)} className="shrink-0" aria-label={`Open generation ${g.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/gallery/${g.file}`} alt="" loading="lazy" className="border-border h-24 w-auto rounded-md border" />
        </button>
      ))}
    </div>
  );
}
