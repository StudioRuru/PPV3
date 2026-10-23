import { NextRequest, NextResponse } from "next/server";
import { chatPersona } from "@/lib/chat-model";
import { getSetting } from "@/lib/db";
import { BRAIN_MODEL } from "@/lib/env";
import { getDrift } from "@/lib/learning";
import { chatStream } from "@/lib/llm";
import { activeIdentity } from "@/lib/mascot/quip";
import { splitExpressionTag } from "@/lib/mascot/talk";
import { tierModel } from "@/lib/tiers";
import { validatePhoto } from "@/lib/comfy/recipe";
import { CHIPS, suggest, type RuleId } from "@/lib/comfy/tuning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One stateless Miyabi reaction: no thread, no history, no GPU. Offline or slow falls back to a canned line inside `suggest`. */
async function complete(ask: string, user: string): Promise<string> {
  const { block, options } = chatPersona("miyabi", getDrift("miyabi"), activeIdentity);
  const system = `${block}\n\n${ask}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    let out = "";
    const run = (async () => { for await (const t of chatStream(system, [{ role: "user", content: user }], { model: tierModel("quick", getSetting, BRAIN_MODEL), options })) out += t; return out; })();
    const stop = new Promise<never>((_, no) => ctl.signal.addEventListener("abort", () => no(new Error("timeout"))));
    return splitExpressionTag(await Promise.race([run, stop])).text;
  } finally { clearTimeout(timer); }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => null);
    let recipe;
    try { recipe = validatePhoto(b?.recipe); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Send the current recipe." }, { status: 400 }); }
    const chip = CHIPS.some((c) => c.id === b.chip) ? (b.chip as RuleId) : undefined;
    const text = typeof b.text === "string" ? b.text.slice(0, 500) : undefined;
    return NextResponse.json(await suggest({ chip, text, recipe }, { complete }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Copilot failed." }, { status: 500 });
  }
}
