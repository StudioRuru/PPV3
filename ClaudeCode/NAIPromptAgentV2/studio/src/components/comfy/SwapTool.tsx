"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { toDataUrl } from "./PoseEditor";

/** A Library photo (by name) or an upload (data URL). */
export type Slot = { file: string } | { data: string };
export type SwapState = { on: boolean; base: Slot | null; head: Slot | null };
export const EMPTY_SWAP: SwapState = { on: false, base: null, head: null };
export const slotUrl = (s: Slot) => ("file" in s ? `/api/comfy/file/${s.file}` : s.data);

type LibItem = { id: number; kind: string; file: string };
const SLOTS = [["base", "Body", "the photo to keep: pose, outfit, lighting"], ["head", "Head", "the face and hair to put on it"]] as const;

/** Qwen head swap (BFS LoRA): pick a body photo and a head photo, from the Library or the phone. */
export function SwapTool({ st, set }: { st: SwapState; set: (p: Partial<SwapState>) => void }) {
  const [items, setItems] = useState<LibItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestJson<{ items: LibItem[] }>("/api/comfy/items").then((r) => r.ok && setItems(r.data.items.filter((i) => i.kind === "photo")));
  }, []);
  const upload = async (k: "base" | "head", f: File) => {
    try { set({ [k]: { data: await toDataUrl(f) } }); setError(null); } catch { setError("Couldn't read that image."); }
  };

  return (
    <div className="space-y-3 text-sm">
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={st.on} onChange={(e) => set({ on: e.target.checked })} className="size-5" />
        Swap head <span className="text-faint text-xs">· the prompt is optional extra detail</span>
      </label>
      {st.on && SLOTS.map(([k, label, hint]) => (
        <div key={k} className="space-y-2">
          <div className="flex items-center gap-2">
            {st[k] ? <img src={slotUrl(st[k])} alt={label} className="size-11 rounded object-cover" /> : <span className="bg-bg size-11 rounded" />}
            <p className="min-w-0 flex-1"><span className="font-medium">{label}</span> <span className="text-faint text-xs">— {hint}</span></p>
            <label className="border-border grid min-h-11 cursor-pointer place-items-center rounded-full border px-3 text-xs">
              Upload
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(k, f); e.target.value = ""; }} />
            </label>
          </div>
          {items.length > 0 && (
            <div className="flex gap-2 overflow-x-auto" aria-label={`${label} from the Library`}>
              {items.slice(0, 24).map((i) => (
                <button key={i.id} type="button" aria-label={`Use Library photo ${i.id} as ${label.toLowerCase()}`} aria-pressed={!!st[k] && "file" in st[k] && st[k].file === i.file}
                  onClick={() => set({ [k]: { file: i.file } })} className="size-11 shrink-0 overflow-hidden rounded aria-pressed:ring-2 aria-pressed:ring-accent">
                  <img src={`/api/comfy/file/${i.file}`} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
