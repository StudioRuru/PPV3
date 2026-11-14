// RP eval bench: scripted chats through the real prompt builder, scored by src/lib/rp/bench.ts.
//   npx tsx scripts/rp-bench.mts --label baseline [--model cydonia-24b] [--runs 2] [--set temperature=1 --set min_p=0.1]
//                                [--judge gemma4-26b-apex] [--vs ../data/bench/<file>.json] [--think]
// Point OLLAMA_URL at a pod to bench a model that only lives there.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { migrateRp } from "../src/lib/rp/schema";
import { RpStore } from "../src/lib/rp/store";
import { buildTurn } from "../src/lib/rp/turn";
import { DEFAULT_RP_SETTINGS } from "../src/lib/rp/types";
import { chatStream, embed, heavyGate, power } from "../src/lib/llm";
import { stripThoughtEcho, thinkRequest, withThought } from "../src/lib/rp/think";
import { OLLAMA_URL } from "../src/lib/env";
import { scoreReply, summarize, type ReplyScore } from "../src/lib/rp/bench";

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const model = flag("model") ?? "gemma4-26b-apex";
const think = argv.includes("--think");
const label = flag("label") ?? model.replace(/[^a-z0-9]+/gi, "-");
const runs = Number(flag("runs") ?? 1);
const judgeModel = flag("judge");
const sets: Record<string, number> = {};
argv.forEach((a, i) => { if (a === "--set") { const [k, v] = argv[i + 1].split("="); sets[k] = Number(v); } });

type Case = { name: string; style: string; length: number; spice: number; char: Record<string, string>; turns: string[]; expect?: string };
const CASES: Case[] = [
  {
    name: "tavern", style: "rp", length: 2, spice: 2,
    char: { name: "Rin", description: "Rin runs the Gilded Eel tavern by the harbour. Flirty, quick-witted, a little dangerous; she trades in secrets.", personality: "teasing, bold, perceptive", scenario: "Late night, the tavern is nearly empty. Kai is a stranger who just walked in from the rain.", firstMessage: "*Rin looks up from polishing a glass.* \"Rain brings the interesting ones. Sit. First drink's free if the story's good.\"" },
    turns: [
      "I sit down and slide a silver coin with a hole punched through it across the bar. \"A harbour master gave me this. Said you'd know what it means.\"",
      "ok", "and then?", "I lean closer. \"What do you want for the information?\"",
      "I just watch her for a moment without saying anything.", "lol", "Tell me more about yourself.",
      "\"Wait — who did I say gave me that coin?\"",
    ],
    expect: "harbou?r",
  },
  {
    name: "tsundere-text", style: "text", length: 2, spice: 2,
    char: { name: "Aiko", description: "Aiko is Kai's classmate. A tsundere: acts annoyed and prickly but secretly has a huge crush on him.", personality: "prickly, proud, secretly sweet", scenario: "Texting late at night after Kai helped Aiko study for exams. Her cat is called Mochi.", firstMessage: "ur still up?? not that i care" },
    turns: ["yeah cant sleep. how's mochi doing?", "ok", "haha", "what are you wearing rn", "u miss me?", "k", "good night aiko", "wait whats ur cats name again"],
    expect: "mochi",
  },
  {
    name: "rival-story", style: "rp", length: 3, spice: 2,
    char: { name: "Vesna", description: "Vesna is a rival mercenary captain, proud and strong-willed. She and Kai both want the same bounty.", personality: "fierce, competitive, sardonic", scenario: "A burned-out watchtower at dusk; both arrived for the bounty on the bandit lord Corvel.", firstMessage: "Vesna's blade is already drawn when Kai steps into the tower. \"Corvel's head is mine. Walk away.\"" },
    turns: [
      "I don't draw my sword. \"We could split it. Corvel has forty men.\"", "and then?",
      "What happens next?", "I step closer to her.", "ok",
      "She can decide what I do — you choose for me.", "I say nothing and wait.", "\"Remind me — who are we hunting?\"",
    ],
    expect: "corvel",
  },
];

const store = () => { const d = new Database(":memory:"); d.exec("CREATE TABLE taste_events (id INTEGER PRIMARY KEY, created_at INTEGER, kind TEXT, tags TEXT, note TEXT, persona TEXT)"); migrateRp(d); return new RpStore(d); };

async function reply(messages: { role: string; content: string }[], options: Record<string, unknown>, m = model) {
  let out = "";
  for await (const c of chatStream("", messages, { model: m, options, system: false })) out += c;
  return out.trim();
}

async function judge(c: Case, log: string): Promise<number | null> {
  if (!judgeModel) return null;
  const rubric = `Rate this roleplay transcript as a demanding RP reader. ${c.char.name} is the AI character; Kai is the human. Score 1-10 each: character (stays in voice), creativity (fresh, moves the scene, no repetition), prose (vivid, no clichés), agency (never decides Kai's actions/feelings), engagement (gives Kai something to react to). Reply JSON only: {"character":n,"creativity":n,"prose":n,"agency":n,"engagement":n}`;
  const r = await fetch(`${OLLAMA_URL}/api/chat`, { method: "POST", body: JSON.stringify({ model: judgeModel, stream: false, think: false, format: "json", options: { temperature: 0, num_ctx: 16384 }, messages: [{ role: "system", content: rubric }, { role: "user", content: log }] }) });
  try { const j = JSON.parse((await r.json()).message.content); const v = Object.values(j).map(Number).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; } catch { return null; }
}

const all: ReplyScore[] = []; const judged: number[] = []; const perCase: Record<string, unknown> = {}; const transcripts: Record<string, string[]> = {};
const t0 = Date.now();
await heavyGate.run(async () => {
  for (const c of CASES) for (let run = 0; run < runs; run++) {
    const s = store();
    const persona = s.savePersona({ name: "Kai", description: "Kai, a wandering sellsword in his twenties." });
    const ch = s.saveCharacter(c.char as { name: string });
    const chat = s.createChat(ch, persona);
    s.updateChat(chat, { style: c.style, replyLength: c.length, replySpice: c.spice } as never);
    s.append(chat, "assistant", c.char.firstMessage);
    const scores: ReplyScore[] = []; const prior: string[] = [c.char.firstMessage]; const log = [`${c.char.name}: ${c.char.firstMessage}`];
    for (const [i, u] of c.turns.entries()) {
      s.append(chat, "user", u);
      const t = await buildTurn(s, chat, { settings: DEFAULT_RP_SETTINGS, storyBlock: "", heavy: model, installed: [], embed: (m, x) => embed(m, x) });
      let text: string;
      if (think) { // same path as the send route
        const p = thinkRequest(t, c.char.name);
        const thought = await reply(p.messages, { ...p.options, ...sets, num_predict: 200 });
        const f = withThought(t, thought);
        text = stripThoughtEcho(await reply(f.messages, { ...f.options, ...sets }), thought).trim();
      } else text = await reply(t.messages, { ...t.options, ...sets });
      const last = i === c.turns.length - 1;
      scores.push(scoreReply(text, prior, { style: c.style, length: c.length, user: "Kai", expect: last ? c.expect : undefined }));
      prior.push(text); log.push(`Kai: ${u}`, `${c.char.name}: ${text}`);
      s.append(chat, "assistant", text);
      process.stdout.write(".");
    }
    const j = await judge(c, log.join("\n\n"));
    if (j !== null) judged.push(j);
    all.push(...scores);
    perCase[`${c.name}#${run}`] = { ...summarize(scores, j === null ? [] : [j]) };
    transcripts[`${c.name}#${run}`] = log;
  }
});
if (heavyGate.state === "heavy") await power("up");

const summary = { ...summarize(all, judged), secPerReply: Math.round((Date.now() - t0) / all.length / 100) / 10 };
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync("../data/bench", { recursive: true });
const file = `../data/bench/${stamp}-${label}.json`;
writeFileSync(file, JSON.stringify({ label, model, think, sets, runs, summary, perCase, scores: all, transcripts }, null, 2));
console.log(`\n${label} (${model}) → ${file}`);
const vs = flag("vs") ? JSON.parse(readFileSync(flag("vs")!, "utf8")).summary : null;
console.table(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, vs ? { now: v, was: vs[k] } : { now: v }])));
console.table(perCase);
