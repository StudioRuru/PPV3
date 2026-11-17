// Heavy-tier bench: the non-RP jobs the heavy model does (card draft, essence, photo tags, Miyabi chat), objective checks + latency.
//   npx tsx --conditions=react-server scripts/heavy-bench.mts [--models a,b]
// Models run one after another (Kobold is stopped before an Ollama model loads: they don't fit together).
import { mkdirSync, writeFileSync } from "node:fs";
import { chatStream, heavyGate, stopKobold } from "../src/lib/llm";
import { analyzeEssence, draftCard } from "../src/lib/rp/draft";
import { cleanTags } from "../src/lib/rp/photo";
import { knownTags } from "../src/lib/tag-index";
import { personaBlock } from "../src/lib/persona";
import { EXPRESSIONS } from "../src/lib/mascot/core";
import { DEFAULT_RP_SETTINGS } from "../src/lib/rp/types";
import type { StudioCard } from "../src/lib/rp/studio-types";

const argv = process.argv.slice(2);
const i = argv.indexOf("--models");
const MODELS = (i >= 0 ? argv[i + 1] : "kobold:Omega-Arsenal-26B-A4B-Final.i1-Q4_K_M_hb16,gemma4-26b-apex:latest").split(",");

const CONCEPTS = [
  "A burned-out former idol who now runs a tiny ramen stall at night; sarcastic to customers, secretly still practices her old dance routines after closing.",
  "A strict elf librarian in a magic academy who hides a stash of trashy romance novels; the user is a student caught after curfew.",
];
const ESSENCE = `Mira: ugh you're late again
Kai: sorry, train
Mira: "train" sure. you owe me a coffee. oat milk. large.
Kai: deal
Mira: and you're carrying my cello case up the stairs, my wrist is still bad from the recital
Kai: how did the recital go?
Mira: don't. the second movement was a disaster. maestro gave me The Look
Mira: whatever. it's fine. i'll practice till 2 again, it's fine`;
const PHOTOS = [
  { base: "1girl, long black hair, red eyes", outfit: "black hoodie, denim shorts", context: "Kai: what are you up to\nRin: lazy sunday, still in bed lol", desc: "a sleepy selfie in bed, hugging a pillow, morning light" },
  { base: "1girl, short blonde hair, blue eyes", outfit: "school uniform, pleated skirt", context: "Aiko: changed for the festival!! dont laugh", desc: "a mirror selfie in a yukata at the summer festival, holding a candy apple, embarrassed" },
];
const CHATS = ["miyabi i'm bored, entertain me", "do you think i should dye my hair pink?", "rate my day: woke up late, missed the bus, found 20 bucks on the ground"];
const TAG_RULE = `End every reply with exactly one expression tag, after everything else, chosen from: ${EXPRESSIONS.map((e) => `[${e}]`).join(" ")}. Example: [smug]`;
const BANNED = /\b(hair|eyes?|breasts?|blonde|ponytail|twintails)\b/;

const filled = (c: StudioCard) => (["name", "description", "personality", "scenario", "firstMessage", "exampleDialogue"] as const).filter((k) => c[k].trim().length > 10 || (k === "name" && c.name.trim())).length
  + (c.tags.length ? 1 : 0) + (c.voiceLines.length ? 1 : 0) + (c.alternateGreetings.length ? 1 : 0);
const timed = async <T,>(f: () => Promise<T>) => { const t = Date.now(); const out = await f(); return { out, sec: (Date.now() - t) / 1000 }; };
const ask = async (model: string, messages: { role: string; content: string }[], options: Record<string, unknown>) => {
  let out = ""; for await (const t of chatStream("", messages, { model, options, system: false, think: false })) out += t; return out;
};

const known = knownTags();
const results: Record<string, unknown> = {};
const table: Record<string, Record<string, number | string>> = {};
await heavyGate.run(async () => {
  for (const model of MODELS) {
    const settings = { ...DEFAULT_RP_SETTINGS, studioModel: model };
    const log: Record<string, unknown>[] = [];
    const row = { draftFields: 0, draftSec: 0, essenceFields: 0, essenceName: 0, tagsValid: 0, tagsBanned: 0, tagsSec: 0, exprOk: 0, chatSec: 0, chatChars: 0 };
    for (const concept of CONCEPTS) {
      const { out, sec } = await timed(() => draftCard(concept, settings));
      row.draftFields += filled(out) / 9 / CONCEPTS.length; row.draftSec += sec / CONCEPTS.length;
      log.push({ job: "draft", concept, sec, card: out });
    }
    { const { out, sec } = await timed(() => analyzeEssence(ESSENCE, "Mira", settings));
      row.essenceFields = filled(out.card) / 9; row.essenceName = out.card.name.trim() === "Mira" ? 1 : 0;
      log.push({ job: "essence", sec, ...out }); }
    for (const p of PHOTOS) {
      const content = [`Write Danbooru tags for a photo the character is sending in a chat.`, `Their look (already tagged, don't repeat): ${p.base}`, `Their usual outfit: ${p.outfit}`,
        `Recent chat:\n${p.context}`, `The photo: ${p.desc}`,
        "Output only comma-separated Danbooru tags, at most 20: pose, expression/mood, the clothes worn in this photo (the usual outfit unless the chat changed it), setting/background, camera framing. No hair/eye/body tags, no names, no sentences."].join("\n\n");
      const { out, sec } = await timed(() => ask(model, [{ role: "user", content }], { temperature: 0.2, num_predict: 160 }));
      const tags = cleanTags(out, known);
      row.tagsValid += tags.length / PHOTOS.length; row.tagsBanned += tags.filter((t) => BANNED.test(t)).length; row.tagsSec += sec / PHOTOS.length;
      log.push({ job: "tags", desc: p.desc, sec, raw: out, tags });
    }
    const system = `${personaBlock("miyabi", 50)}\n${TAG_RULE}`;
    for (const text of CHATS) {
      const { out, sec } = await timed(() => ask(model, [{ role: "system", content: system }, { role: "user", content: text }], { temperature: 0.9, num_predict: 400 }));
      const tags = out.match(/\[([a-z]+)\]/g) ?? [];
      const ok = tags.length === 1 && EXPRESSIONS.includes(tags[0].slice(1, -1) as never) && out.trim().endsWith(tags[0]);
      row.exprOk += (ok ? 1 : 0) / CHATS.length; row.chatSec += sec / CHATS.length; row.chatChars += out.length / CHATS.length;
      log.push({ job: "chat", text, sec, reply: out, exprOk: ok });
    }
    if (model.startsWith("kobold:")) await stopKobold();
    results[model] = { row, log };
    table[model.replace(/^kobold:/, "").slice(0, 28)] = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  }
});
mkdirSync("../data/bench", { recursive: true });
const file = `../data/bench/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-heavy.json`;
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`→ ${file}`);
console.table(table);
process.exit(0);
