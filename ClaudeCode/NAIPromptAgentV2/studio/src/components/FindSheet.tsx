"use client";
import { useState } from "react";
import { requestJson } from "@/lib/net";
import type { Rating } from "@/lib/prompt";
import type { RawTag } from "@/lib/tagger";
import { Sheet } from "./Sheet";

type Post = { id: number; rating: string; preview: string; large: string; w: number; h: number; character: string; copyright: string; artist: string; tags: RawTag[] };
const spaced = (s: string) => s.replace(/_/g, " ");

export function FindSheet({ open, onClose, rating, onRecreate }: {
  open: boolean; onClose: () => void; rating: Rating; onRecreate: (tags: RawTag[]) => void;
}) {
  const [q, setQ] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Post | null>(null);

  async function search(p: number) {
    setBusy(true); setError(null);
    const r = await requestJson<{ posts: Post[]; more: boolean }>(`/api/danbooru?${new URLSearchParams({ q, rating, page: String(p) })}`);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPage(p); setMore(r.data.more);
    setPosts(p === 1 ? r.data.posts : [...posts, ...r.data.posts]);
  }

  return (
    <Sheet open={open} onClose={onClose} label="Find on Danbooru" closeLabel="Close find"
      className="h-[88dvh] rounded-t-2xl border-t lg:h-full lg:max-w-md lg:rounded-none lg:border-l">
      <header className="flex items-center gap-2 p-3">
        {pick && <button type="button" onClick={() => setPick(null)} aria-label="Back to results" className="border-border h-11 w-11 shrink-0 rounded-full border">‹</button>}
        <h2 className="flex-1 text-base font-semibold">{pick ? `Post ${pick.id}` : "Find on Danbooru"}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="border-border h-11 w-11 shrink-0 rounded-full border">×</button>
      </header>

      {pick ? (
        <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pick.large} alt={`Danbooru post ${pick.id}`} className="border-border w-full rounded-lg border" style={{ aspectRatio: `${pick.w}/${pick.h}` }} />
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-sm">
            {([["character", pick.character], ["series", pick.copyright], ["artist", pick.artist]] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-faint font-mono text-xs leading-5">{k}</dt><dd className="break-words">{v.split(" ").map(spaced).join(", ")}</dd></div>
            ))}
            <dt className="text-faint font-mono text-xs leading-5">tags</dt><dd className="text-muted">{pick.tags.length}</dd>
          </dl>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(1); }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. hatsune miku, smile" aria-label="Danbooru tags"
              enterKeyHint="search" autoCapitalize="none" autoCorrect="off" className="bg-bg border-border min-w-0 flex-1 rounded-md border px-2 py-2.5 text-base" />
            <button type="submit" disabled={busy || !q.trim()} className="bg-accent text-accent-fg rounded-md px-4 font-semibold disabled:opacity-40">Search</button>
          </form>
          <p className="text-faint font-mono text-[11px]">up to 2 tags, comma-separated · rating follows {rating.toUpperCase()}</p>
          {error && <p role="alert" className="text-danger text-sm">{error}</p>}
          {posts.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {posts.map((p) => (
                <button key={p.id} type="button" onClick={() => setPick(p)} aria-label={`Open post ${p.id}`} className="bg-bg overflow-hidden rounded-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {!busy && !error && page > 0 && posts.length === 0 && <p className="text-muted text-sm">Search by character, series or look. Pick a result to recreate it.</p>}
          {posts.length > 0 && more && (
            <button type="button" disabled={busy} onClick={() => search(page + 1)} className="border-border w-full rounded-md border px-3 py-2.5 text-sm">{busy ? "Loading…" : "More"}</button>
          )}
          {busy && posts.length === 0 && <p className="text-muted text-sm">Searching…</p>}
        </div>
      )}

      {pick && (
        <div className="border-border border-t p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          <button type="button" onClick={() => { onRecreate(pick.tags); onClose(); }} className="bg-accent text-accent-fg w-full rounded-lg px-4 py-3 font-semibold">Recreate this image</button>
        </div>
      )}
    </Sheet>
  );
}
