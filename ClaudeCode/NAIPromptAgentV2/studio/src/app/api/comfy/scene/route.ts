import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { BRAIN_MODEL, REPO_DIR } from "@/lib/env";
import { chatStream, heavyGate, Offline } from "@/lib/llm";
import { installedModels } from "@/lib/rp/server";
import { knownTags } from "@/lib/tag-index";
import { listLoras, localIsWan } from "@/lib/comfy/loras";
import { resolveInfo } from "@/lib/comfy/lora-info";
import { readManifest } from "@/lib/comfy/pod";
import { cleanScene, parseScene, sceneHistory, scenePrompt, TARGETS, type SceneChat, type Target } from "@/lib/comfy/scene";
import { comfyDb, getJson, putJson } from "@/lib/comfy/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEY = "scene.chat";
const empty = (): SceneChat => ({ target: "anime", model: BRAIN_MODEL, turns: [] });
const models = async () => [BRAIN_MODEL, ...(await installedModels()).filter((m) => /^(kobold|chub):/.test(m))];
const readRef = (f: string) => { try { return fs.readFileSync(path.join(REPO_DIR, ".claude/skills/prompt/references", f), "utf8"); } catch { return ""; } };

/** Installed LoRAs with family and triggers, from the same source as /api/comfy/loras + lora-info. Wan ones get family "wan" (R8). */
async function sceneLoras() {
  const names = (await listLoras()).map((l) => l.name);
  let manifestSha = new Map<string, string>();
  try { manifestSha = new Map(readManifest().filter((e) => e.kind === "loras").map((e) => [e.filename, e.sha256])); } catch { /* no manifest */ }
  const info = await resolveInfo(names, { db: comfyDb(), manifestSha });
  return Promise.all(names.map(async (name) => ({ name, words: info[name]?.words ?? [], family: ((await localIsWan(name)) ? "wan" : info[name]?.family ?? null) as never })));
}

export async function GET() {
  return NextResponse.json({ chat: getJson<SceneChat>(comfyDb(), KEY) ?? empty(), models: await models() });
}

export async function DELETE() {
  putJson(comfyDb(), KEY, empty());
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) ?? {};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const target = body.target as Target;
  if (!text || text.length > 4000) return NextResponse.json({ error: "Text must be 1-4000 characters." }, { status: 400 });
  if (!Object.hasOwn(TARGETS, target)) return NextResponse.json({ error: "Unknown target." }, { status: 400 });
  const all = await models();
  const model = typeof body.model === "string" ? body.model : BRAIN_MODEL;
  if (!all.includes(model)) return NextResponse.json({ error: "Unknown model." }, { status: 400 });

  const db = comfyDb();
  const chat = getJson<SceneChat>(db, KEY) ?? empty();
  const loras = await sceneLoras();
  const system = scenePrompt(target, loras, readRef);
  const messages = [...sceneHistory(chat.turns), { role: "user", content: text }];
  const heavy = model !== BRAIN_MODEL;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const put = (t: string) => { try { ctl.enqueue(enc.encode(t)); } catch { /* client gone: keep going so the turn is saved */ } };
      const answer = async () => {
        let reply = "";
        for await (const t of chatStream(system, messages, { model: heavy ? model : undefined })) { const s = t.replaceAll("\0", ""); reply += s; put(s); }
        const { prose, out: raw } = parseScene(reply);
        const cleaned = cleanScene(raw, { target, known: knownTags(), loras });
        const dropped = cleaned?.dropped ?? [];
        // Fresh read narrows the lost-turn race between concurrent POSTs.
        const turns = [...(getJson<SceneChat>(db, KEY) ?? chat).turns, { role: "user" as const, content: text }, { role: "assistant" as const, content: prose, ...(cleaned && { out: cleaned.out }), ...(dropped.length && { dropped }) }].slice(-30);
        putJson(db, KEY, { target, model, turns });
        put(`\n\u0000${JSON.stringify({ out: cleaned?.out ?? null, dropped })}`);
      };
      try {
        await (heavy ? heavyGate.run(answer) : answer());
      } catch (e) {
        console.error("[comfy] scene failed:", e);
        const m = e instanceof Offline ? "Model offline." : /paused|busy/i.test((e as Error).message) ? "The model is busy — try again" : "The scene model failed — try again or pick another model";
        put(`\n\n⚠️ ${m}`);
      }
      try { ctl.close(); } catch { /* client already gone */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
