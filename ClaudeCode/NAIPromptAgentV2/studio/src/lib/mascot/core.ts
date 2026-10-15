// Miyabi mascot core rules: pure, shared by client and server.
export const EXPRESSIONS = ["smug", "laughing", "wink", "pout", "flirty", "shocked", "annoyed", "excited", "sleepy"] as const;
export type Expression = (typeof EXPRESSIONS)[number];
export type Outfit = "day" | "night" | "lewd";
export type MascotEvent = {
  kind: "generated" | "upscaled" | "error" | "applied" | "prompt_edit" | "closet_use" | "idle" | "greet" | "rp_feedback" | "rp_chat" | "tap";
  at: number;
  data?: Record<string, unknown>;
};
type Kind = MascotEvent["kind"];

const STALE_MS = 30_000;

export function shouldSpeak(
  e: MascotEvent,
  s: { now: number; hushUntil: number; typing: boolean; lastSpokeAt: number; cooldownMs: number; inFlight: boolean },
): boolean {
  if (s.inFlight) return false;
  if (e.kind === "tap") return true;
  if (s.now < s.hushUntil || s.typing || s.now - e.at > STALE_MS) return false;
  const priority = e.kind === "error" || e.kind === "greet" || (e.kind === "generated" && e.data?.first === true);
  return s.now - s.lastSpokeAt >= (priority ? s.cooldownMs / 2 : s.cooldownMs);
}

export function parseQuip(raw: string): { expression: Expression; text: string } | null {
  let t = raw.trim();
  let expression: Expression | null = null;
  // peel quote/markdown wrappers, "Miyabi:" prefixes and [tag] in any order
  for (let i = 0; i < 3; i++) {
    const lead = t.replace(/^[\s*_"'“‘]+/, "");
    const wrapped = /^(miyabi|\[)/i.test(lead) && lead !== t.trimStart();
    if (/^(miyabi|\[)/i.test(lead)) t = lead;
    t = t.replace(/^miyabi\s*[:\-–]\s*[*_]*\s*/i, "");
    const m = t.match(/^\[([^\]]*)\]/);
    if (!m) continue;
    const x = m[1].trim().toLowerCase() as Expression;
    if (!expression && EXPRESSIONS.includes(x)) expression = x;
    t = t.slice(m[0].length);
    if (wrapped) t = t.replace(/^[*_"'”’]+/, ""); // closer of a wrapped tag, e.g. **[smug]**
  }
  t = t.replace(/^\s*["'“‘]+/, "");
  t = (t.split("\n").find((l) => l.trim()) ?? "").trim();
  t = t
    .replace(/^[#>]+\s*/, "")
    .replace(/(\*\*|\*)(.+?)\1/g, "$2")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/["'“”‘’]+$/, "")
    .trim();
  if (!t) return null;
  if (t.length > 220) {
    const sp = t.slice(0, 221).lastIndexOf(" "); // 221 so a space at index 220 keeps the whole word
    t = (sp > 0 ? t.slice(0, sp) : t.slice(0, 220)).trim();
  }
  return { expression: expression ?? "smug", text: t };
}

export function outfitFor(o: { hour: number; nightFrom: number; nightTo: number; pin: Outfit | null; nsfw: boolean; flirt: boolean; flirtyTalk?: boolean }): Outfit {
  if (o.pin) return o.pin;
  if (o.nsfw && (o.flirt || o.flirtyTalk)) return "lewd";
  const { hour: h, nightFrom: f, nightTo: t } = o;
  if (f === t) return "day";
  return (f < t ? h >= f && h < t : h >= f || h < t) ? "night" : "day";
}

export function pickSprite(have: Set<string>, outfit: Outfit, expression: Expression): string | null {
  return [`${outfit}/${expression}`, `day/${expression}`, `${outfit}/smug`, "day/smug"].find((id) => have.has(id)) ?? null;
}

const L = (expression: Expression, text: string) => ({ expression, text });
const POOL: Record<Kind, { expression: Expression; text: string }[]> = {
  generated: [L("smug", "Oh look, it actually finished. Don't look at me like that, I'm impressed. A little."), L("excited", "Ooh, fresh one! Show me, show me, show me!"), L("flirty", "Mmm, that one came out dangerously cute. Like someone I know.")],
  upscaled: [L("smug", "Bigger and sharper. Just how you like it, right?"), L("wink", "Upscaled~ Now I can see every little detail. Every. Little. One."), L("excited", "Ahh, so crisp! Frame it, or whatever you weirdos do.")],
  error: [L("annoyed", "Ugh, it broke. And you're glaring at me like it's my fault."), L("laughing", "Pfft, it errored! Skill issue, honestly."), L("pout", "Don't blame me! I told you that was a bad idea. ...Okay I didn't, but I thought it.")],
  applied: [L("wink", "Applied~ Smooth, I'll give you that."), L("smug", "Look at you, making decisions. Cute."), L("excited", "Done! That was easy, wasn't it? You're welcome.")],
  prompt_edit: [L("smug", "Tweaking again? Perfectionist. Or just can't stop touching it."), L("laughing", "Another edit? Bold of you to think it needed one."), L("flirty", "Mm, I like it when you take your time with it.")],
  closet_use: [L("flirty", "Raiding the closet, hm? Pick something good. I'm watching."), L("wink", "Ooh, outfit time. Should I be nervous or excited?"), L("smug", "Wow, a whole wardrobe and you picked that one. Brave.")],
  idle: [L("sleepy", "Hellooo? Did you fall asleep on me? Rude."), L("pout", "You're ignoring me. I can tell. I always can."), L("smug", "Staring at the screen won't make it generate itself, y'know.")],
  greet: [L("excited", "Finally! I was getting bored. Miss me?"), L("flirty", "Well well, look who came crawling back to me."), L("smug", "Back already? Can't stay away from me, huh.")],
  rp_feedback: [L("laughing", "Hahaha, she's fun! Keep going, I wanna see how this ends."), L("flirty", "Ooh, getting spicy in there. Don't mind me, I'm just watching."), L("smug", "Not bad. Not bad at all. I'd have been meaner, though.")],
  rp_chat: [L("wink", "Having fun with your little roleplay? Don't forget about me."), L("smug", "She's cute, but I'm cuter. Just saying."), L("flirty", "Mm, such a good storyteller. Keep talking.")],
  tap: [L("shocked", "Hey! Hands off... unless you're gonna do it again."), L("flirty", "Ooh, poking me now? Bold. I like it."), L("annoyed", "Do you mind? I'm busy being adorable."), L("laughing", "Hehe, that tickles! Do it again, I dare you.")],
};

export function cannedLine(kind: Kind, rand: () => number = Math.random): { expression: Expression; text: string } {
  const p = POOL[kind];
  return p[Math.min(p.length - 1, Math.floor(rand() * p.length))];
}

export const readMs = (text: string): number => Math.min(9000, 2500 + 45 * text.length);
