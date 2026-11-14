import { applyCharacterOverrides, assembleMessages, settingsToOptions } from "./prompt";
import type { RpStore } from "./store";
import type { ChatMessage, RpSettings, SamplerOptions } from "./types";
import { selectVoiceLines, type Embed } from "./voice";
import { charName as nameOf, parseProfile, resolveSpice, type RpProfile } from "./profile";

export type TurnDeps = { settings: RpSettings; storyBlock: string; heavy: string; installed: string[]; embed: Embed };
export type Turn = { messages: ChatMessage[]; options: SamplerOptions; model: string; truncated: boolean };

/**
 * Everything needed to ask the model for the next reply in a chat. With `replacing` (regenerate), history stops before
 * that reply. A chat/character model that isn't installed any more falls back to the heavy tier.
 */
// Directions for alternates / fresh turns. Spice gates the pool: below Default stays mature-but-not-sexual;
// Default+ leans sensual, Explicit+ goes all the way. {{char}}/{{user}} are filled in.
const DIRECTIONS = {
  mature: [
    "give {{char}} a different emotional reaction than before", "let {{char}} take the initiative and push the scene forward",
    "change the pacing — slower and more intimate, or quicker and punchier", "let a hidden want or old wound of {{char}}'s show through",
    "add tension: jealousy, rivalry, or a dangerous secret", "let {{char}} be morally grey — tempted, selfish, or cruel in a way that fits them",
    "shift the power balance between {{char}} and {{user}}",
  ],
  sensual: [
    "let charged physical tension build — lingering looks, closeness, a touch that lasts too long", "have {{char}} flirt boldly and tease {{user}}",
    "let {{char}}'s desire slip out in what they say or do", "make it intimate: focus on breath, warmth, and how close they are",
    "have {{char}} play a power game of seduction with {{user}}", "let {{char}} confess or show attraction they've been hiding",
  ],
  explicit: [
    "escalate the intimacy hard — {{char}} acts on their desire without holding back", "have {{char}} take control and make a bold, explicit advance",
    "go further than the earlier drafts dared, in vivid explicit detail", "let {{char}} voice exactly what they want from {{user}}, crudely and honestly",
  ],
  wild: [
    "throw in a surprising turn of events nobody saw coming", "have {{char}} do something bold and out of their usual comfort zone",
    "escalate the scene dramatically", "reveal something unexpected about {{char}}", "flip the mood of the scene on its head",
  ],
};
// Close chat: talk, not narration. Story: novelist openings.
const CHAT_OPENINGS = [
  { kind: "dialogue", text: "Start with a quick reaction text to {{user}}'s message" },
  { kind: "dialogue", text: "Start by texting {{user}} a question back — personal or teasing" },
  { kind: "action", text: "Start by texting what {{char}} is doing or wearing right now" },
  { kind: "thought", text: "Start by texting how {{char}} feels right now, a little too honestly" },
];
const STORY_OPENINGS = [
  { kind: "world", text: "Open by narrating the setting or something happening around them" },
  { kind: "action", text: "Open by narrating a physical action of {{char}}'s" },
  { kind: "thought", text: "Open inside {{char}}'s head — what they notice, want, or fear" },
  { kind: "body", text: "Open on {{char}}'s body language reacting to {{user}}" },
  { kind: "dialogue", text: "Open on {{char}}'s spoken line, then narrate around it" },
];
const VOICE: Record<string, string> = {
  "": "Keep the same narrative voice and person as your earlier replies — don't switch between \"I\" and third person.",
  chat: "Write only {{char}}'s texts — short separate messages, casual, no *actions* or narration.",
  story: "Keep narrating in the third person — never \"I\" outside of dialogue.",
};
const OPENINGS = [
  { kind: "dialogue", text: "Open with a line of {{char}}'s dialogue" },
  { kind: "action", text: "Open with a physical action by {{char}}" },
  { kind: "thought", text: "Open with a glimpse of what {{char}} is feeling, narrated about {{char}}" },
  { kind: "world", text: "Open with something happening around them — a sound, the room, another person" },
  { kind: "body", text: "Open on {{char}}'s body language reacting to {{user}}" },
];
/** Rough opening kind of a reply, so the next one opens some other way. */
export const openingKind = (t: string) => (/^\s*["“]/.test(t) ? "dialogue" : /^\s*\*/.test(t) ? "action" : "thought");
const openingsFor = (style: string) => (style === "chat" ? CHAT_OPENINGS : style === "story" ? STORY_OPENINGS : OPENINGS);
const snip = (t: string, n: number) => { const x = t.replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };

export type Steer = { drafts?: string[]; recent?: string[]; wild?: boolean; spice: number; charName: string; userName: string; style?: string; profile?: RpProfile | null };

/**
 * Keeps replies fresh. Every turn: a fresh seed, an opening unlike the last reply's, "don't reuse your recent openings",
 * and sometimes a direction. Regenerate (`drafts`): the earlier drafts to avoid, always a direction, hotter sampler per
 * retry. `wild` goes further still. min_p is floored so high temperatures stay coherent.
 */
export function steerTurn(turn: Turn, o: Steer, rand = Math.random): Turn {
  const fill = (t: string) => t.replaceAll("{{char}}", o.charName).replaceAll("{{user}}", o.userName);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const pools = [...DIRECTIONS.mature, ...(o.spice >= 2 ? DIRECTIONS.sensual : []), ...(o.spice >= 3 ? DIRECTIONS.explicit : [])];
  // Adult pools are favoured when the chat allows them; wild mixes in plot-level chaos.
  const adult = o.spice >= 3 ? DIRECTIONS.explicit.concat(DIRECTIONS.sensual) : o.spice >= 2 ? DIRECTIONS.sensual : DIRECTIONS.mature;
  const pool = o.wild ? (rand() < 0.5 ? DIRECTIONS.wild : adult) : rand() < 0.6 ? adult : pools;
  const regen = !!o.drafts?.length;
  const last = regen ? o.drafts!.at(-1)! : o.recent?.at(-1);
  const all = openingsFor(o.style ?? "");
  // Close chat always opens with talk, so only the other styles rotate away from the last reply's kind.
  const opening = pick(o.style === "chat" ? all : all.filter((x) => !last || x.kind !== openingKind(last)));
  const lines = [regen
    ? `[Alternate take] Write a reply that is clearly different from these earlier drafts — different opening, different gestures, different choices, different phrasing. Don't reuse their lines.`
    : `[Keep it fresh] Don't reuse the openings, gestures or stock phrases of your recent replies.`];
  lines.push(`${fill(opening.text)}. ${fill(VOICE[o.style ?? ""] ?? VOICE[""])}`);
  // The character's own wants, fears, tics and story hooks beat generic directions when the profile has them.
  const own = o.profile ? [
    ...o.profile.wants.map((w) => `let {{char}}'s want show — ${w}`), ...o.profile.fears.map((f) => `let {{char}}'s fear surface — ${f}`),
    ...o.profile.speech.tics.map((t) => `work in {{char}}'s habit: ${t}`), ...o.profile.hooks.map((h) => `pull on a thread: ${h}`),
  ] : [];
  if (regen || o.wild || rand() < 0.35) lines.push(`Direction: ${fill(pick(own.length && rand() < 0.7 ? own : pool))}.`);
  if (regen) lines.push(`Earlier drafts:\n${o.drafts!.slice(-3).map((d) => `- ${snip(d, 280)}`).join("\n")}`);
  else if (o.recent?.length) lines.push(`Your recent openings:\n${o.recent.slice(-3).map((d) => `- ${snip(d, 90)}`).join("\n")}`);
  const base = turn.options.temperature ?? 0.9;
  const heat = o.wild ? 0.5 : regen ? Math.min(0.1 + 0.08 * o.drafts!.length, 0.35) : 0;
  return {
    ...turn,
    messages: [...turn.messages, { role: "system", content: lines.join("\n") }],
    options: {
      ...turn.options, seed: Math.floor(rand() * 2 ** 31),
      ...(heat ? { temperature: Math.min(base + heat, o.wild ? 1.8 : 1.5), min_p: Math.max(turn.options.min_p ?? 0, o.wild ? 0.08 : 0.05) } : {}),
      ...(o.wild ? { top_p: 1 } : {}),
    },
  };
}

export async function buildTurn(store: RpStore, chatId: number, deps: TurnDeps, replacing?: number, wild = false): Promise<Turn> {
  const chat = store.chat(chatId);
  if (!chat) throw new Error("Chat not found");
  // The chat's reply length also sets the token cap + context budget, or a per-chat "Epic" gets cropped at the global cap.
  const settings = { ...deps.settings, replyLength: chat.replyLength ?? deps.settings.replyLength };
  const character = chat.characterId ? store.character(chat.characterId) : null;
  const persona = store.persona(chat.personaId);
  let history = store.messages(chatId);
  if (replacing) history = history.filter((m) => m.id < replacing);
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const voiceLines = character ? await selectVoiceLines(store, character.id, lastUser, deps.settings.embedModel, deps.embed) : [];
  const r = assembleMessages({
    settings, character, persona, chat, history, voiceLines, storyBlock: deps.storyBlock,
    lore: store.loreFor(chat, character),
  });
  const pinned = [chat.model, character?.model].find((m) => m && deps.installed.includes(m));
  const turn: Turn = {
    messages: r.messages,
    options: applyCharacterOverrides(settingsToOptions(settings, r.stop), character?.samplerOverrides),
    model: pinned || deps.heavy,
    truncated: r.truncated,
  };
  const profile = parseProfile(character?.profile ?? null);
  const old = replacing ? store.messages(chatId).find((m) => m.id === replacing) : undefined;
  return foldSystem(steerTurn(turn, {
    drafts: old ? (old.swipes.length ? old.swipes : [old.content]) : undefined,
    recent: history.filter((m) => m.role === "assistant").slice(-3).map((m) => m.content),
    wild, style: chat.style, spice: resolveSpice(chat, profile, deps.settings), charName: character ? nameOf(character) : "the character", userName: persona?.name ?? "User",
    profile,
  }));
}

/**
 * One leading system block; every later system note is folded into a user turn (prepended to the next one, or appended
 * to the last one when it trails). Mistral-family templates render a system message after [/INST] as a fresh system
 * block, and the model then continues the instructions instead of replying (cydonia: empty or leaked-instruction replies).
 */
export function foldSystem(turn: Turn): Turn {
  const ms = turn.messages;
  const lead = ms.findIndex((m) => m.role !== "system");
  if (lead < 0) return turn;
  const head = ms.slice(0, lead).map((m) => m.content);
  const out: ChatMessage[] = [];
  let pending: string[] = [];
  for (const m of ms.slice(lead)) {
    if (m.role === "system") { pending.push(m.content); continue; }
    if (m.role === "user" && pending.length) { out.push({ ...m, content: `${pending.join("\n\n")}\n\n${m.content}` }); pending = []; continue; }
    out.push(m);
  }
  // Trailing notes join the last turn only when it's the user's; after a reply (nothing to answer) they stay a system message.
  const last = out.at(-1);
  if (pending.length && last?.role === "user") out[out.length - 1] = { ...last, content: `${last.content}\n\n${pending.join("\n\n")}` };
  else if (pending.length) out.push({ role: "system", content: pending.join("\n\n") } as ChatMessage);
  return { ...turn, messages: [...(head.length ? [{ role: "system", content: head.join("\n\n") } as ChatMessage] : []), ...out] };
}
