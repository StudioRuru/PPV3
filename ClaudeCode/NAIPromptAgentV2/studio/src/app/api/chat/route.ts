import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { MODE_HINT, retrieve, systemPrompt, trimHistory, type ChatMsg, type Mode } from "@/lib/copilot-prompt";
import { db } from "@/lib/db";
import { DATA_DIR, REPO_DIR } from "@/lib/env";
import { listBlocks } from "@/lib/library";
import { chatStream, Offline } from "@/lib/llm";
import { emptyState } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const SYNTAX = path.join(REPO_DIR, ".claude/skills/prompt/references/v5-syntax.md");
const STYLE = path.join(DATA_DIR, "copilot-style.md");

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) ?? {};
  const messages: ChatMsg[] = (Array.isArray(body.messages) ? body.messages : []).filter(
    (m: ChatMsg) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string");
  const last = messages.at(-1);
  if (last?.role !== "user" || !last.content.trim()) return new Response("Empty message.", { status: 400 });
  const mode: Mode = Object.hasOwn(MODE_HINT, body.mode) ? body.mode : "chat";
  const hint = MODE_HINT[mode];
  const sent = trimHistory(messages).map((m, i, a) => (i === a.length - 1 && hint ? { ...m, content: `${hint}\n\n${m.content}` } : m));
  const system = systemPrompt({ syntax: read(SYNTAX), style: read(STYLE), state: { ...emptyState(), ...body.state }, blocks: retrieve(last.content, listBlocks()) });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      let reply = "";
      try {
        for await (const t of chatStream(system, sent)) { reply += t; ctl.enqueue(enc.encode(t)); }
        // Only complete exchanges reach history.
        const ins = db.prepare("INSERT INTO chat_messages (created_at, role, content) VALUES (?, ?, ?)");
        db.transaction(() => { ins.run(Date.now(), "user", last.content); ins.run(Date.now(), "assistant", reply); })();
      } catch (e) {
        const msg = e instanceof Offline ? "Brain offline — start Ollama on the Mac." : (e as Error).message;
        ctl.enqueue(enc.encode(`\n\n⚠️ ${msg}`));
      }
      ctl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
