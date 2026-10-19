import type { Note } from "./notebook";

export type Link = { id: number; parent_id: number | null; parent_at: number | null };

/** Ancestor chain of `id` (self first); each entry's `cut` is the last index shared with its child (Infinity for self). */
function chain(id: number, links: Link[]) {
  const by = new Map(links.map((l) => [l.id, l]));
  const out: { id: number; cut: number }[] = [];
  const seen = new Set<number>();
  let cut = Infinity;
  let cur = by.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push({ id: cur.id, cut });
    if (cur.parent_id == null || !by.has(cur.parent_id)) break;
    cut = cur.parent_at ?? -1;
    cur = by.get(cur.parent_id);
  }
  return out;
}

export function timeline(
  note: Pick<Note, "kind" | "thread_id" | "msg_index">,
  current: number,
  links: Link[],
): "here" | "other-version" {
  if (note.kind !== "moment" || note.thread_id == null || note.msg_index == null) return "here";
  const mine = chain(current, links);
  const theirs = chain(note.thread_id, links);
  if (!theirs.length || !mine.length) return "here"; // thread gone
  if (mine[mine.length - 1].id !== theirs[theirs.length - 1].id) return "here"; // different root
  const hit = mine.find((c) => c.id === note.thread_id);
  return hit && note.msg_index <= hit.cut ? "here" : "other-version";
}

const NEW = "You're only just getting to know each other.";

export function notebookBlock(notes: Note[], current: number, links: Link[], budget = 6000): string {
  if (!notes.length) return "";
  const stance = notes.find((n) => n.kind === "stance")?.text ?? NEW;
  const head =
    `# You and the owner (this matters more than the persona above)\n${stance}\n` +
    `Let how close you are shape how you act with them, even where the persona above says otherwise.\n`;
  const H1 = "\n# What you remember\n";
  const H2 = "\n# From another version of this conversation (it happened; it feels like déjà vu)\n";
  const here: string[] = [];
  const other: string[] = [];
  let used = head.length - stance.length; // budget covers the whole block except the stance text itself
  for (const n of notes) {
    if (n.kind === "stance") continue;
    const into = timeline(n, current, links) === "here" ? here : other;
    const line = `- ${n.text}\n`;
    const cost = line.length + (into.length ? 0 : (into === here ? H1 : H2).length);
    if (used + cost > budget) continue;
    used += cost;
    into.push(line);
  }
  return head + (here.length ? H1 + here.join("") : "") + (other.length ? H2 + other.join("") : "");
}
