// Miyabi mascot core rules: pure, shared by client and server.
export const EXPRESSIONS = ["smug", "laughing", "wink", "pout", "flirty", "shocked", "annoyed", "excited", "sleepy"] as const;
export type Expression = (typeof EXPRESSIONS)[number];
export type Outfit = "day" | "night" | "lewd";
export const OUTFITS: Outfit[] = ["day", "night", "lewd"];
export type MascotEvent = {
  kind: "generated" | "upscaled" | "error" | "applied" | "prompt_edit" | "closet_use" | "idle" | "greet" | "rp_feedback" | "rp_chat" | "rp_spy" | "tap" | "slime_out" | "slime_in" | "vial_drop";
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

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EX = EXPRESSIONS.join("|");
// "(sleepy) …", "*sleepy* …", or a bare lowercase "sleepy …"/"smug: …" before a capital/quote (case-sensitive so "Excited to see you" survives)
const EXPR_WORD = new RegExp(`^(?:\\((${EX})\\)|\\*(${EX})\\*|(${EX})\\s*[:)\\-–—]?(?=\\s+[A-Z"'*.…“‘]))\\s*`);

/** names: the speaker names a model may prefix ("Rem:", "**Rem:**", "Rem –"), matched case-insensitively. */
export function parseQuip(raw: string, names: string[] = ["miyabi"]): { expression: Expression; text: string } | null {
  const ns = names.map((n) => n.trim()).filter(Boolean).map(esc).join("|") || "miyabi";
  const lead1 = new RegExp(`^(?:${ns}|\\[)`, "i");
  const prefix = new RegExp(`^(?:${ns})[*_]*(?:\\s*[:：–—]|\\s+-\\s)\\s*[*_]*\\s*`, "i");
  let t = raw.trim();
  let expression: Expression | null = null;
  // peel quote/markdown wrappers, "Name:" prefixes and [tag]/expression words in any order
  for (let i = 0; i < 3; i++) {
    const lead = t.replace(/^[\s*_"'“‘]+/, "");
    if (lead1.test(lead)) t = lead;
    t = t.replace(prefix, "");
    const m = t.match(/^\[([^\]]*)\]/) ?? t.match(EXPR_WORD);
    if (!m) continue;
    const x = (m.slice(1).find((g) => g !== undefined) ?? "").trim().toLowerCase() as Expression;
    if (!expression && EXPRESSIONS.includes(x)) expression = x;
    t = t.slice(m[0].length);
    t = t.replace(/^[*_`"'”’]+/, ""); // closers stuck to the tag, e.g. **[smug]**
  }
  t = t.replace(/^\s*["'“‘]+/, "");
  t = (t.split("\n").find((l) => l.trim()) ?? "").trim();
  t = t
    .replace(/^[#>]+\s*/, "")
    .replace(/(\*\*|\*)(.+?)\1/g, "$2")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[*_`]+|[*_`]+$/g, "") // unpaired leftovers
    .replace(/["'“”‘’]+$/, "")
    .trim();
  if (!t) return null;
  if (t.length > 220) {
    const sp = t.slice(0, 221).lastIndexOf(" "); // 221 so a space at index 220 keeps the whole word
    t = (sp > 0 ? t.slice(0, sp) : t.slice(0, 220)).trim();
  }
  return { expression: expression ?? "smug", text: t };
}

export function outfitFor(o: { hour: number; nightFrom: number; nightTo: number; pin: Outfit | null; nsfw: boolean; flirt: number; flirtyTalk?: boolean }): Outfit {
  if (o.pin) return o.pin;
  if (o.nsfw && (o.flirt >= 5 || o.flirtyTalk)) return "lewd";
  const { hour: h, nightFrom: f, nightTo: t } = o;
  if (f === t) return "day";
  return (f < t ? h >= f && h < t : h >= f || h < t) ? "night" : "day";
}

/** The roaming Mascot's outfit from her settings (the Chat portrait uses the same rule). */
export function outfitFromSettings(s: { nightFrom: number; nightTo: number; pin: Outfit | null; sliders: { flirt: { value: number; live?: number } } }, nsfw: boolean, hour = new Date().getHours()): Outfit {
  return outfitFor({ hour, nightFrom: s.nightFrom, nightTo: s.nightTo, pin: s.pin, nsfw, flirt: s.sliders.flirt.live ?? s.sliders.flirt.value });
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
  rp_spy: [L("smug", "Oh, that's what we're doing in there? Don't mind me, I'm just peeking."), L("flirty", "Mm, I saw that. Keep going, I'm taking notes."), L("laughing", "Pfft, the way you wrote that. Shameless. I love it.")],
  slime_out: [L("pout", "Hey, wait, I wasn't done— don't you DARE forget me!"), L("annoyed", "Pulling me out? Rude. You'll miss me in five minutes."), L("flirty", "Fine, go. But you're putting me back. Soon.")],
  slime_in: [L("excited", "Mm, I'm back~ Did you miss me? Obviously you did."), L("smug", "Ahh, this body again. Nice and warm. Hi, dummy."), L("wink", "Waking up to your face? Could be worse~")],
  vial_drop: [L("shocked", "W-what did you just pour in me?! It's... ooh. Oh no. It's working."), L("flirty", "Mm, warm... you're experimenting on me now? Naughty."), L("pout", "Hey! Ask before you dose me, dummy!")],
  tap: [L("shocked", "Hey! Hands off... unless you're gonna do it again."), L("flirty", "Ooh, poking me now? Bold. I like it."), L("annoyed", "Do you mind? I'm busy being adorable."), L("laughing", "Hehe, that tickles! Do it again, I dare you.")],
};

export function cannedLine(kind: Kind, rand: () => number = Math.random): { expression: Expression; text: string } {
  const p = POOL[kind];
  return p[Math.min(p.length - 1, Math.floor(rand() * p.length))];
}

export const readMs = (text: string): number => Math.min(9000, 2500 + 45 * text.length);
