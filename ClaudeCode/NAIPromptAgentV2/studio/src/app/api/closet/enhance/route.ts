import { NextRequest, NextResponse } from "next/server";
import { enhancePrompt, parseEnhance, type EnhanceAction, type Field, type Kind } from "@/lib/closet";
import { brainUp, chatStream } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["modify", "add", "remove", "combine", "mutate"]);

/** { kind, fields, action, ask, other? } → { prose, fields } from the local brain (not streamed; ~1 min). */
export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { kind?: Kind; fields?: Field[]; action?: EnhanceAction; ask?: string; other?: { label: string; fields: Field[] } };
  if (!b.kind || !Array.isArray(b.fields) || !b.action || !ACTIONS.has(b.action)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (!(await brainUp())) return NextResponse.json({ error: "The co-pilot is off — turn it on in Chat first." }, { status: 503 });
  const { system, user } = enhancePrompt(b.kind, b.fields, b.action, b.ask ?? "", b.other);
  let text = "";
  try {
    for await (const chunk of chatStream(system, [{ role: "user", content: user }])) text += chunk;
  } catch (e) {
    return NextResponse.json({ error: `Co-pilot stopped: ${(e as Error).message}` }, { status: 502 });
  }
  const r = parseEnhance(text, b.fields);
  return r.error ? NextResponse.json({ error: r.error, prose: r.prose }, { status: 422 }) : NextResponse.json(r);
}
