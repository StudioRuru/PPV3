"use client";
import type { NaiParams } from "@/lib/nai-body";
import type { PromptState } from "@/lib/prompt";

// For <img className="animate-develop">: marks the image loaded so the develop-in starts with real pixels.
export const developed = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.dataset.loaded = ""; };

export type Generation = { id: number; file: string; seed: number; model: string; state: PromptState; params: NaiParams; created_at?: number };

export function HistoryStrip({ items, onOpen }: { items: Generation[]; onOpen: (g: Generation) => void }) {
  if (!items.length) return <p className="text-muted text-sm">No generations yet.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {items.map((g) => (
        <button key={g.id} type="button" onClick={() => onOpen(g)} className="shrink-0" aria-label={`Open generation ${g.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/gallery/${g.file}`} alt="" loading="lazy" onLoad={developed} onError={developed} className="border-border animate-develop h-24 w-auto rounded-md border" />
        </button>
      ))}
    </div>
  );
}
