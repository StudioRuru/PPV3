"use client";
import type { CastMember, RpProfile } from "@/lib/rp/profile";
import { AutoTextarea } from "../TagInput";

const field = "bg-bg border-border mt-1 w-full rounded-md border px-2 py-2 text-base";
const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

type ListKey = "coreTraits" | "wants" | "fears" | "knows" | "doesntKnow" | "wouldNever" | "hooks" | "relationships";
const LISTS: [ListKey, string][] = [
  ["coreTraits", "Core traits"], ["wants", "Wants"], ["fears", "Fears"], ["knows", "Knows"], ["doesntKnow", "Doesn't know"],
  ["wouldNever", "Would never"], ["hooks", "Story hooks"], ["relationships", "Relationships"],
];

/** The character's distilled profile, every list one item per line. Card conflicts are shown, not edited. */
export function ProfileEditor({ value, onChange, onRebuild, busy }: { value: RpProfile | null; onChange: (p: RpProfile) => void; onRebuild: () => void; busy?: boolean }) {
  const rebuild = (
    <button type="button" onClick={onRebuild} disabled={busy} className="border-border h-10 rounded-lg border px-3 text-sm disabled:opacity-40">
      {busy ? "Reading the card…" : value ? "Rebuild profile" : "Build profile"}
    </button>
  );
  if (!value) return <div className="space-y-2"><p className="text-muted text-xs">No profile yet — the model reads the card and avatar to build one.</p>{rebuild}</div>;
  const p = value;
  const set = (patch: Partial<RpProfile>) => onChange({ ...p, ...patch });
  const castText = p.cast.map((m) => (m.role ? `${m.name} — ${m.role}` : m.name)).join("\n");
  const setCast = (v: string) => set({
    cast: lines(v).map((l): CastMember => {
      const [name, ...role] = l.split(/\s+[—-]\s+/);
      const prev = p.cast.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
      return { name: name.trim(), role: role.join(" — ").trim(), ...(prev?.appearanceTags ? { appearanceTags: prev.appearanceTags } : {}) };
    }),
  });
  return (
    <div className="space-y-3">
      {p.conflicts.length > 0 && (
        <div role="note" className="border-warn/40 bg-warn/10 rounded-lg border p-2 text-xs">
          {p.conflicts.map((x) => <p key={x}>⚠️ The card forbids: {x}</p>)}
        </div>
      )}
      <label className="block text-xs"><span className="text-muted">Cast (one speaker per line, “Name — role”)</span>
        <AutoTextarea value={castText} onChange={setCast} /></label>
      {LISTS.map(([k, label]) => (
        <label key={k} className="block text-xs"><span className="text-muted">{label} (one per line)</span>
          <AutoTextarea value={p[k].join("\n")} onChange={(v) => set({ [k]: lines(v) })} /></label>
      ))}
      <label className="block text-xs"><span className="text-muted">Speech register</span>
        <input value={p.speech.register} onChange={(e) => set({ speech: { ...p.speech, register: e.target.value } })} className={field} /></label>
      <label className="block text-xs"><span className="text-muted">Verbal tics (one per line)</span>
        <AutoTextarea value={p.speech.tics.join("\n")} onChange={(v) => set({ speech: { ...p.speech, tics: lines(v) } })} /></label>
      <label className="block text-xs"><span className="text-muted">Sample lines (one per line)</span>
        <AutoTextarea value={p.speech.sampleLines.join("\n")} onChange={(v) => set({ speech: { ...p.speech, sampleLines: lines(v) } })} /></label>
      <label className="block text-xs"><span className="text-muted">View of you</span>
        <input value={p.viewOfUser} onChange={(e) => set({ viewOfUser: e.target.value })} className={field} /></label>
      <label className="block text-xs"><span className="text-muted">Output format the card uses</span>
        <AutoTextarea value={p.format} onChange={(v) => set({ format: v })} /></label>
      <label className="block text-xs"><span className="text-muted">Appearance tags (photos; the card's appearance prompt wins)</span>
        <input value={p.appearanceTags} onChange={(e) => set({ appearanceTags: e.target.value })} className={field} /></label>
      {rebuild}
    </div>
  );
}
