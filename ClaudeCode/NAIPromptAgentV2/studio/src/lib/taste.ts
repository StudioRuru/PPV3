/** What the co-pilot learns about the owner's taste, from what they apply, like and dislike. */
export type TasteEvent = { kind: "apply" | "like" | "dislike"; tags: string[]; note: string; created_at: number };
export type Profile = { favoured: string[]; avoided: string[]; notes: string[] };

const key = (t: string) => t.trim().replace(/^-?[\d.]+::|::$/g, "").replace(/[{}[\]]/g, "").trim().toLowerCase();
const SCORE = { apply: 1, like: 2, dislike: -3 } as const;

/** Events oldest → newest. */
export function profile(events: TasteEvent[]): Profile {
  const score = new Map<string, number>();
  for (const e of events) for (const t of new Set(e.tags.map(key).filter(Boolean))) score.set(t, (score.get(t) ?? 0) + SCORE[e.kind]);
  const all = [...score.entries()];
  return {
    favoured: all.filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t),
    avoided: all.filter(([, s]) => s < 0).sort((a, b) => a[1] - b[1]).map(([t]) => t),
    notes: events.filter((e) => e.note.trim()).map((e) => e.note.trim()).reverse(),
  };
}

/** Prompt block, capped so learning can't crowd out the conversation. */
export function tasteBlock(p: Profile, pinned: string[]): string {
  const parts = [
    pinned.length ? `Always follow:\n${pinned.slice(0, 10).map((r) => `- ${r}`).join("\n")}` : "",
    p.favoured.length ? `Owner likes: ${p.favoured.slice(0, 20).join(", ")}` : "",
    p.avoided.length ? `Owner dislikes (avoid): ${p.avoided.slice(0, 10).join(", ")}` : "",
    p.notes.length ? `Recent feedback:\n${p.notes.slice(0, 5).map((n) => `- ${n.slice(0, 200)}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? `# What the owner likes (learned)\n${parts.join("\n")}` : "";
}
