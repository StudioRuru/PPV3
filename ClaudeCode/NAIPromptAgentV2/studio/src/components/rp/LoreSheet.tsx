"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/net";
import { postHaptic } from "@/lib/native";
import { charName } from "@/lib/rp/profile";
import type { RpLorebook } from "@/lib/rp/store";
import type { RpChat } from "@/lib/rp/types";
import { Sheet } from "../Sheet";
import type { GalleryChar } from "./RpScreen";

/** 📖 Lore: the card's own books (read-only), this chat's book, and a file import that attaches straight to the chat. */
export function LoreSheet({ open, onClose, character, chat, onPatch }: {
  open: boolean; onClose: () => void; character: GalleryChar; chat: RpChat; onPatch: (body: object) => Promise<boolean>;
}) {
  const [books, setBooks] = useState<RpLorebook[]>([]);
  const [bookId, setBookId] = useState(chat.lorebookId);
  const [msg, setMsg] = useState<{ error?: string; note?: string }>({});
  const load = () => requestJson<{ lorebooks: RpLorebook[] }>("/api/rp/lore").then((r) => r.ok && setBooks(r.data.lorebooks));
  useEffect(() => { if (open) { setBookId(chat.lorebookId); setMsg({}); load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh on open only

  const pick = (v: number | null) => {
    const prev = bookId; setBookId(v);
    onPatch({ op: "chat", lorebookId: v }).then((ok) => { postHaptic(ok ? "success" : "error"); if (!ok) setBookId(prev); });
  };
  async function importBook(f?: File) {
    if (!f) return;
    setMsg({ note: "Importing…" });
    const fd = new FormData(); fd.append("file", f);
    const r = await requestJson<{ id: number; entries: number }>("/api/rp/lore", { method: "POST", body: fd });
    if (!r.ok) { postHaptic("error"); setMsg({ error: r.error }); return; }
    setMsg({ note: `Imported ${r.data.entries} entries — now on for this chat.` });
    pick(r.data.id); load();
  }
  const card = ([[character.lorebookId, `From ${charName(character)}'s card`], [character.worldLorebookId, "World"]] as const)
    .filter(([id]) => id != null).map(([id, label]) => ({ id: id!, label, book: books.find((b) => b.id === id) }));

  return (
    <Sheet open={open} onClose={onClose} label="Lorebooks" closeLabel="Close lorebooks" className="max-h-[88dvh] rounded-t-2xl border-t lg:max-h-none lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center p-3"><h2 className="flex-1 text-base font-semibold">📖 Lorebooks</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border size-11 rounded-full border">×</button></header>
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}>
        <section className="space-y-1.5">
          <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">Character</h3>
          {card.length ? card.map((c) => (
            <div key={c.label} className="glass flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{c.book?.name ?? `Lorebook #${c.id}`}<span className="text-faint block text-xs">{c.label}</span></span>
              <span className="text-faint text-xs">{c.book ? `${c.book.count ?? 0} entries` : "…"}</span>
            </div>
          )) : <p className="text-faint text-sm">None on this card</p>}
        </section>
        <label className="block text-sm"><span className="text-muted text-xs font-semibold tracking-wide uppercase">This chat</span>
          <span className="text-faint block text-xs">Added on top of the character&rsquo;s books, for this chat only.</span>
          <select value={bookId ?? ""} onChange={(e) => pick(Number(e.target.value) || null)}
            className="bg-bg border-border mt-1 h-11 w-full rounded-md border px-2 text-base">
            <option value="">None</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.count ?? 0})</option>)}
          </select>
        </label>
        <label className="bg-accent text-accent-fg flex h-11 cursor-pointer items-center justify-center rounded-full text-sm font-semibold focus-within:outline-2">
          Import .json…
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { importBook(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {msg.error && <p role="alert" className="text-danger text-sm">{msg.error}</p>}
        {msg.note && <p role="status" className="text-muted text-sm">{msg.note}</p>}
        <p className="text-faint text-xs">Takes SillyTavern World Info or a character card with an embedded book.</p>
      </div>
    </Sheet>
  );
}
