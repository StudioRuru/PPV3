import { NextRequest, NextResponse } from "next/server";
import { learnedStoryBlock } from "@/lib/learning";
import { chatStream, embed, heavyGate, isPod, Offline } from "@/lib/llm";
import { shouldSummarize, summarizeChat } from "@/lib/rp/memory";
import { heavyModel, installedModels, rp, rpSettings } from "@/lib/rp/server";
import { charName } from "@/lib/rp/profile";
import { stripThoughtEcho, thinkOn, thinkRequest, withThought } from "@/lib/rp/think";
import { buildTurn } from "@/lib/rp/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `{ text, version }` sends a message; `{ regenerate: msgId, wild?, version }` adds another (deliberately different) swipe to that reply;
 * `{ retry: true, version }` answers the chat's last message when it's the user's (after a failed reply).
 * Streams the reply as plain text. The user's message is saved first, so a failed reply never loses it.
 * Header `X-Paused: 1` = the captioner/TIPO were paused to fit the heavy model.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const chatId = Number((await params).id);
  const b = await req.json().catch(() => null);
  if (!b || !rp.chat(chatId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const conflict = () => NextResponse.json({ error: "This chat changed on another device — reload it.", conflict: true }, { status: 409 });
  let expect = typeof b.version === "number" ? b.version : undefined;
  const replacing = b.regenerate ? Number(b.regenerate) : undefined;

  if (replacing) {
    const last = rp.messages(chatId).at(-1);
    if (last?.id !== replacing || last.role !== "assistant") return NextResponse.json({ error: "Only the last reply can be regenerated." }, { status: 400 });
    if (expect !== undefined && rp.version(chatId) !== expect) return conflict();
  } else if (b.retry) {
    if (rp.messages(chatId).at(-1)?.role !== "user") return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
    if (expect !== undefined && rp.version(chatId) !== expect) return conflict();
  } else {
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Empty message." }, { status: 400 });
    if (rp.append(chatId, "user", text.slice(0, 20_000), expect) === null) return conflict();
  }
  expect = rp.version(chatId)!;

  const settings = rpSettings();
  const heavy = heavyModel();
  const turn = await buildTurn(rp, chatId, { settings, storyBlock: learnedStoryBlock(), heavy, installed: await installedModels(), embed }, replacing, b.wild === true);
  // The pod has its own GPU: no need to pause the Mac's captioner + TIPO for it.
  const gate = <T,>(f: () => Promise<T>) => (isPod(turn.model) ? f() : heavyGate.run(f));
  const willPause = !isPod(turn.model) && heavyGate.state === "light";
  const enc = new TextEncoder();
  const chat0 = rp.chat(chatId)!;
  const char = chat0.characterId != null ? rp.character(chat0.characterId) : null;
  const thinking = thinkOn(chat0, chat0.style, settings);

  const stream = new ReadableStream({
    async start(ctl) {
      let reply = "";
      let thought = "";
      try {
        await gate(async () => {
          if (thinking) {
            const plan = thinkRequest(turn, char ? charName(char) : "the character");
            for await (const t of chatStream("", plan.messages, { model: plan.model, options: plan.options, system: false })) thought += t;
            thought = thought.trim();
          }
          const final = thought ? withThought(turn, thought) : turn;
          for await (const t of chatStream("", final.messages, { model: final.model, options: final.options, system: false })) {
            reply += t;
            try { ctl.enqueue(enc.encode(t)); } catch { /* client gone: keep generating so the reply is saved */ }
          }
          if (!reply.trim()) try { ctl.enqueue(enc.encode(`\n\n⚠️ ${turn.model} returned nothing — tap Retry.`)); } catch { /* gone */ }
          // ponytail: the echo is stripped from the saved reply only; the live stream may briefly show it.
          const out = thought ? stripThoughtEcho(reply, thought).trim() : reply.trim();
          const saved = out ? (replacing ? rp.addSwipe(replacing, out, expect, thought) : rp.append(chatId, "assistant", out, expect, thought) !== null) : true;
          if (!saved) try { ctl.enqueue(enc.encode("\n\n⚠️ Not saved: this chat changed on another device while I was answering.")); } catch { /* gone */ }
          // Memory refresh on the model that's already loaded; detached so the stream can close.
          const chat = rp.chat(chatId);
          if (saved && chat && shouldSummarize(rp.messages(chatId), chat.summarizedThrough, turn.truncated)) {
            void gate(() => summarizeChat(rp, chatId, { model: turn.model, numCtx: settings.numCtx, stream: (m, o) => chatStream("", m, { model: turn.model, options: o, system: false }) })).catch(() => {});
          }
        });
      } catch (e) {
        const msg = e instanceof Offline ? "Ollama is offline — start it on the Mac." : `${(e as Error).message}${/memory|load/i.test(String(e)) ? " — the heavy model needs the captioner and TIPO paused; try again." : ""}`;
        try { ctl.enqueue(enc.encode(`\n\n⚠️ ${msg}`)); } catch { /* gone */ }
      }
      try { ctl.close(); } catch { /* gone */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Paused": willPause ? "1" : "0", "X-Model": turn.model, "X-Thinking": thinking ? "1" : "0" } });
}
