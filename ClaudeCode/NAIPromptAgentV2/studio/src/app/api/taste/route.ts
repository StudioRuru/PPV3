import { NextRequest, NextResponse } from "next/server";
import { currentProfile, getDrift, pin, pinned, recordEvent, resetLearning, setDrift, unpin } from "@/lib/learning";
import { liveIdentity } from "@/lib/mascot/quip";
import { PERSONAS, type PersonaId } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const isPersona = (p: unknown): p is PersonaId => PERSONAS.some((x) => x.id === p);

export function GET() {
  return NextResponse.json({ profile: currentProfile(), pinned: pinned(), drift: Object.fromEntries(PERSONAS.map((p) => [p.id, getDrift(p.id)])) });
}

/** Actions: { event: {kind, tags, note, persona} } | { pin: text } | { unpin: id } | { drift: {persona, value} } | { reset: true, alsoPinned? } */
export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const e = b.event as { kind?: string; tags?: unknown; note?: unknown; persona?: unknown } | undefined;
  if (e && ["apply", "like", "dislike"].includes(e.kind ?? "")) {
    recordEvent(e.kind as "apply", Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [], typeof e.note === "string" ? e.note : "", isPersona(e.persona) ? e.persona : "neutral");
    if (e.kind === "dislike" && e.persona === "miyabi") liveIdentity.drift("dislike"); // brat (+heat if allowed) creeps up; no-op when Empty
  } else if (typeof b.pin === "string" && b.pin.trim()) pin(b.pin);
  else if (typeof b.unpin === "number") unpin(b.unpin);
  else if (b.drift && isPersona((b.drift as { persona?: unknown }).persona)) setDrift((b.drift as { persona: PersonaId }).persona, Number((b.drift as { value?: unknown }).value) || 0);
  else if (b.reset === true) resetLearning(b.alsoPinned === true);
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return GET();
}
