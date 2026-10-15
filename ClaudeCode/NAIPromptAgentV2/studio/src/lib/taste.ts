/** What the co-pilot learns about the owner's taste, from what they apply, like and dislike. */
/** `source: "rp"` = feedback on a roleplay reply: it shapes stories (storyBlock), never the tag profile. */
export type TasteEvent = { kind: "apply" | "like" | "dislike"; tags: string[]; note: string; created_at: number; source?: "tag" | "rp" };
export type Profile = { favoured: string[]; avoided: string[]; notes: string[] };

const key = (t: string) => t.trim().replace(/^-?[\d.]+::|::$/g, "").replace(/[{}[\]]/g, "").trim().toLowerCase();
const SCORE = { apply: 1, like: 2, dislike: -3 } as const;

/** Events oldest → newest. */
export function profile(all: TasteEvent[]): Profile {
  const events = all.filter((e) => e.source !== "rp");
  const score = new Map<string, number>();
  for (const e of events) for (const t of new Set(e.tags.map(key).filter(Boolean))) score.set(t, (score.get(t) ?? 0) + SCORE[e.kind]);
  const scored = [...score.entries()];
  return {
    favoured: scored.filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t),
    avoided: scored.filter(([, s]) => s < 0).sort((a, b) => a[1] - b[1]).map(([t]) => t),
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

/** How the owner likes stories, from feedback on RP replies (events oldest → newest). Capped at 1500 chars. */
export function storyBlock(events: TasteEvent[]): string {
  const rp = events.filter((e) => e.source === "rp" && e.note.trim()).reverse();
  const notes = (kind: TasteEvent["kind"], n: number) => rp.filter((e) => e.kind === kind).slice(0, n).map((e) => `- ${e.note.trim().slice(0, 200)}`);
  const liked = notes("like", 8), avoid = notes("dislike", 5);
  const parts = [liked.length ? `Liked:\n${liked.join("\n")}` : "", avoid.length ? `Avoid:\n${avoid.join("\n")}` : ""].filter(Boolean);
  return parts.join("\n").slice(0, 1500);
}
