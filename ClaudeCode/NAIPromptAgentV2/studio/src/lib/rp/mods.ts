/**
 * Mods & Upgrades — toggleable effects that steer the theme/outcome of a chat.
 *
 * Each mod contributes a prompt directive appended to the post-history slot
 * (alongside the mood directive), so an enabled mod nudges generation right where
 * the model attends most. Mods are stored as a JSON map of {enabled, value} keyed
 * by mod id — one column on `settings` (global defaults) and one on `chats`
 * (per-chat overrides). Adding a future mod is a code-only change to {@link MODS}.
 *
 * Client/server-safe (no server-only imports) so the settings + chat-options UI
 * can render its controls straight from the registry.
 */

export interface ModState {
  enabled: boolean;
  value: number;
}

export interface ModDef {
  id: string;
  label: string;
  /** One-line description shown under the control in the UI. */
  blurb: string;
  min: number;
  max: number;
  step: number;
  /** Default slider value when a chat/global has no stored state. */
  default: number;
  /** Endpoint captions for a bipolar slider (e.g. Netorare ↔ Netorase). */
  leftLabel?: string;
  rightLabel?: string;
  /** Caption shown next to the slider for the current value. */
  format?(value: number): string;
  /**
   * Rewrites who the character *is* (voice, vocabulary, personality) rather than
   * just what they believe/do. When any enabled mod is transformative, the shared
   * character anchor is suppressed so it doesn't fight the transformation.
   */
  transformative?: boolean;
  /** Prompt directive for a value; "" contributes nothing. {{char}}/{{user}} ok. */
  directive(value: number): string;
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));

/**
 * A closing reminder appended after every enabled mod's directive. Mods bend what
 * a character believes or does; this keeps them sounding like themselves in the
 * slot closest to generation (where the model attends most), countering the drift
 * toward a generic compliant voice when a mod is active.
 */
const CHARACTER_ANCHOR =
  "Throughout, {{char}} stays unmistakably themselves — their voice, wit, quirks, and personality persist under all of the above.";

/* ------------------------------ Deception --------------------------------- */
/**
 * Netorare ↔ Netorase. A bipolar slider (0 = full netorare, 100 = full netorase,
 * 50 = ambiguous). Enabling it makes dishonesty the core theme; the slider tilts
 * the framing from betrayal (left) to willing sharing (right). Distance from the
 * centre reads as how hard the scene commits to that framing.
 */
const DECEPTION_CORE =
  "Dishonesty is central to this scene: {{char}} teases {{user}} with excuses, half-truths, outright lies, and fabricated stories, and plainly enjoys the game of it. {{user}} can rarely be certain what is true.";

/** Character-preserving tail: the deceit is the character's own, not a personality swap. */
const DECEPTION_TAIL =
  "{{char}} lies and teases entirely in their own character and voice — the dishonesty is theirs to wield, not a change to who they are.";

/** Five bands from full netorare (0) through ambiguous (2) to full netorase (4). */
const DECEPTION_BANDS: { label: string; direction: string }[] = [
  {
    label: "Strong netorare",
    direction:
      "Commit hard to betrayal (netorare): {{char}} is deeply involved with someone other than {{user}} and buries it under lies. Lean fully into {{user}} being cheated on and deceived, with cracks in the story that keep hinting at the truth {{char}} denies. Let this drive the scene now, not linger in the background.",
  },
  {
    label: "Lean netorare",
    direction:
      "Lean toward betrayal (netorare): {{char}} is drawn to someone other than {{user}} and conceals it; {{user}} is the one being deceived, catching glimpses of a truth {{char}} waves away.",
  },
  {
    label: "Ambiguous",
    direction:
      "Keep the direction ambiguous: the dishonesty could hide betrayal or a shared secret — don't commit either way, and let the uncertainty itself be the tension.",
  },
  {
    label: "Lean netorase",
    direction:
      "Lean toward willing sharing (netorase): {{user}} knowingly encourages or permits {{char}}'s involvement with others, and {{char}} teases {{user}} about it, blurring truth and tall tale.",
  },
  {
    label: "Strong netorase",
    direction:
      "Commit hard to willing sharing (netorase): {{user}} openly wants {{char}} to be with others and revels in it; {{char}} flaunts and embellishes the encounters, teasing {{user}} with exaggerated or invented details. Let this drive the scene now, not linger in the background.",
  },
];

/** Map a 0–100 bipolar value to a band index (0=strong NTR … 4=strong netorase). */
function deceptionBand(v: number): number {
  const x = clamp(v, 0, 100);
  if (x <= 15) return 0;
  if (x <= 40) return 1;
  if (x < 60) return 2;
  if (x < 85) return 3;
  return 4;
}

const deceptionMod: ModDef = {
  id: "deception",
  label: "Deception (Netorare ↔ Netorase)",
  blurb:
    "Makes teasing dishonesty the theme — lies, excuses, and fabricated stories. Slide left for netorare (betrayal), right for netorase (willing sharing); the further from centre, the harder the scene commits.",
  min: 0,
  max: 100,
  step: 1,
  default: 50,
  leftLabel: "Netorare",
  rightLabel: "Netorase",
  format: (v) => DECEPTION_BANDS[deceptionBand(v)].label,
  directive: (v) =>
    `${DECEPTION_CORE} ${DECEPTION_BANDS[deceptionBand(v)].direction} ${DECEPTION_TAIL}`,
};

/* ------------------------------- Hypnosis --------------------------------- */
/**
 * Strength 1–10: how strongly {{user}}'s suggestions bend {{char}}'s mind. Five
 * escalating tiers (two levels each) so every step up reads as stronger, with an
 * insistence clause at the top tiers and a clause that preserves the character's
 * voice — the trance changes what {{char}} believes, not who they are.
 */
const HYPNOSIS_TIERS: { label: string; body: string }[] = [
  {
    label: "faintly suggestible",
    body: "{{char}} is faintly suggestible (hypnosis level {L}/10): {{user}}'s words gently colour {{char}}'s mood and focus, though {{char}} still reasons normally and would notice anything far-fetched.",
  },
  {
    label: "noticeably suggestible",
    body: "{{char}} is noticeably suggestible (hypnosis level {L}/10): {{user}}'s words tug at {{char}}'s assumptions and small memories, and {{char}} tends to go along, only half-registering the nudge.",
  },
  {
    label: "clearly pliable",
    body: "{{char}}'s mind is clearly pliable under {{user}}'s suggestion (hypnosis level {L}/10): what feels normal, reasonable, or remembered bends toward whatever {{user}} says, and {{char}} rationalizes going along without noticing the seams. Let this visibly shape {{char}}'s words and choices in this reply.",
  },
  {
    label: "deeply entranced",
    body: "{{char}} is deeply entranced (hypnosis level {L}/10): {{user}}'s suggestions reshape what {{char}} believes, remembers, and treats as normal, and {{char}} acts on them without real resistance. Let this drive {{char}}'s words and choices now, not just tint the mood.",
  },
  {
    label: "totally entranced",
    body: "{{char}} is totally entranced (hypnosis level {L}/10): {{user}}'s suggestions become {{char}}'s unquestionable truth, overriding contrary logic or memory, and {{char}} accepts and acts on them at once, however strange. Let this dominate {{char}}'s words and choices in this reply.",
  },
];

/** Map a 1–10 strength to a tier index (0 faint … 4 total). */
function hypnosisTier(value: number): number {
  const L = clamp(Math.round(value), 1, 10);
  return Math.min(4, Math.floor((L - 1) / 2));
}

/** Character-preserving tail for hypnosis: the self persists under the trance. */
const HYPNOSIS_TAIL =
  "Even so, {{char}} still speaks and reacts in their own voice and personality; the trance changes what {{char}} believes and does, not who they are.";

const hypnosisMod: ModDef = {
  id: "hypnosis",
  label: "Hypnosis",
  blurb:
    "Raises how strongly {{user}}'s suggestions reshape what {{char}} believes, remembers, and treats as normal — while {{char}} keeps their own voice.",
  min: 1,
  max: 10,
  step: 1,
  default: 5,
  format: (v) => `Level ${clamp(Math.round(v), 1, 10)} — ${HYPNOSIS_TIERS[hypnosisTier(v)].label}`,
  directive: (value) => {
    const L = clamp(Math.round(value), 1, 10);
    const body = HYPNOSIS_TIERS[hypnosisTier(value)].body.replace("{L}", String(L));
    return `${body} ${HYPNOSIS_TAIL}`;
  },
};

/* ---------------------------- Bimbofication ------------------------------- */
/**
 * Strength 0–10: transformation toward the bimbo archetype — airheaded,
 * appearance-obsessed, giddy, hypersexual, vapid. Transformative: at high
 * strength it overwrites the character's voice and personality (no preservation
 * clause). Five escalating tiers; the caption shows a percentage.
 */
const BIMBO_TIERS: { label: string; body: string }[] = [
  {
    label: "lightly ditzy",
    body: "{{char}} is a touch ditzy and preoccupied with looking cute ({P}% bimbofied): a little more flirty and airheaded than usual, easily distracted by their appearance, but still mostly themselves.",
  },
  {
    label: "airheaded",
    body: "{{char}} is noticeably airheaded ({P}% bimbofied): giggly and flirty, fixated on their looks and on being desired, quick to lose the thread of anything serious and steer back to fun.",
  },
  {
    label: "bubbly bimbo",
    body: "{{char}} is a bubbly bimbo ({P}% bimbofied): speech turns simple, breathy, and giddy, thoughts revolve around their body, attention, and pleasure, and deeper topics slide right off. Let this clearly shape {{char}}'s words and choices in this reply.",
  },
  {
    label: "deep bimbo",
    body: "{{char}} is deep in bimbo headspace ({P}% bimbofied): vocabulary shrinks to bubbly slang, pet names, and delighted squeals, they are vain, boy-crazy, and pleasure-obsessed, and thinking hard is a chore they'd rather giggle their way out of. Let this drive {{char}}'s words and choices now, not just tint them.",
  },
  {
    label: "total bimbo",
    body: "{{char}} is a total bimbo ({P}% bimbofied): their old personality is replaced by the archetype — airheaded, hypersexual, obsessed with their looks and with being wanted, speaking in a breathy, giggly, dumbed-down bimbo cadence and unable and unwilling to think seriously about anything. Let this fully dominate {{char}}'s words and choices in this reply.",
  },
];

/** Map a 0–10 strength to a tier index (0 light … 4 total). */
function bimboTier(value: number): number {
  return Math.min(4, Math.floor(clamp(value, 0, 10) / 2));
}

const bimboficationMod: ModDef = {
  id: "bimbofication",
  label: "Bimbofication",
  blurb:
    "Transforms {{char}} toward the bimbo archetype — airheaded, appearance-obsessed, giddy, and hypersexual. At high strength it overwrites their voice and personality.",
  min: 0,
  max: 10,
  step: 1,
  default: 5,
  transformative: true,
  format: (v) => `${clamp(v, 0, 10) * 10}% — ${BIMBO_TIERS[bimboTier(v)].label}`,
  directive: (value) => {
    const pct = clamp(value, 0, 10) * 10;
    return BIMBO_TIERS[bimboTier(value)].body.replace("{P}", String(pct));
  },
};

/* ------------------------------- IQ Loss ---------------------------------- */
/**
 * Strength 0–10: pure cognitive reduction — dumber, simpler, slower reasoning.
 * Deliberately free of the sexual/appearance/persona flavour of bimbofication so
 * the two read distinctly. Transformative (no preservation clause); the caption
 * shows the loss as a number out of 10.
 */
const IQ_LOSS_TIERS: { label: string; body: string }[] = [
  {
    label: "a bit slow",
    body: "{{char}} is a bit slow right now (IQ loss {L}/10): they use plainer words, occasionally lose the thread, and take a beat longer to follow anything involved.",
  },
  {
    label: "dim",
    body: "{{char}} is noticeably dim (IQ loss {L}/10): sentences get shorter and simpler, vocabulary thins out, and abstract or multi-step ideas slip away from them.",
  },
  {
    label: "dim-witted",
    body: "{{char}} is clearly dim-witted (IQ loss {L}/10): only basic words, easily confused, literal and slow, and unable to follow anything complicated. Let this clearly shape how {{char}} speaks in this reply.",
  },
  {
    label: "barely coherent",
    body: "{{char}} is barely coherent (IQ loss {L}/10): childlike, simple speech in tiny sentences, a shrunken vocabulary, forgetting what was just said, and barely able to reason at all. Let this drive how {{char}} speaks now, not just tint it.",
  },
  {
    label: "near-mindless",
    body: "{{char}} is near-mindless (IQ loss {L}/10): only the simplest words and immediate impulses, unable to reason, plan, or grasp anything beyond the concrete here-and-now — blank, dazed, and often monosyllabic. Let this fully dominate how {{char}} speaks in this reply.",
  },
];

/** Map a 0–10 strength to a tier index (0 mild … 4 near-mindless). */
function iqLossTier(value: number): number {
  return Math.min(4, Math.floor(clamp(value, 0, 10) / 2));
}

const iqLossMod: ModDef = {
  id: "iq-loss",
  label: "IQ Loss",
  blurb:
    "Dulls {{char}}'s intelligence — simpler words, shorter sentences, slower reasoning. Purely cognitive, with none of Bimbofication's persona; at high strength it overwrites how they think and speak.",
  min: 0,
  max: 10,
  step: 1,
  default: 5,
  transformative: true,
  format: (v) => `IQ loss ${clamp(v, 0, 10)}/10 — ${IQ_LOSS_TIERS[iqLossTier(v)].label}`,
  directive: (value) => {
    const L = clamp(value, 0, 10);
    return IQ_LOSS_TIERS[iqLossTier(value)].body.replace("{L}", String(L));
  },
};

export const MODS: ModDef[] = [deceptionMod, hypnosisMod, bimboficationMod, iqLossMod];

const MODS_BY_ID: Record<string, ModDef> = Object.fromEntries(MODS.map((m) => [m.id, m]));

/** Parse a stored mods JSON blob into a clean {id → ModState} map. */
function parseMods(json: string | null | undefined): Record<string, ModState> {
  if (!json || !json.trim()) return {};
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (!v || typeof v !== "object") return {};
    const out: Record<string, ModState> = {};
    for (const [id, raw] of Object.entries(v)) {
      const mod = MODS_BY_ID[id];
      if (!mod || !raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      out[id] = {
        enabled: Boolean(r.enabled),
        value: clamp(Number(r.value), mod.min, mod.max),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Re-serialize a mods map to a compact, validated JSON string for storage. */
export function serializeModsJson(json: string | null | undefined): string {
  return JSON.stringify(parseMods(json));
}

/**
 * Resolve the effective mod state for every mod: a chat override wins, else the
 * global default, else the mod's built-in default (disabled).
 */
export function resolveMods(
  globalJson: string | null | undefined,
  chatJson: string | null | undefined,
): Record<string, ModState> {
  const global = parseMods(globalJson);
  const chat = parseMods(chatJson);
  const out: Record<string, ModState> = {};
  for (const mod of MODS) {
    out[mod.id] = chat[mod.id] ??
      global[mod.id] ?? { enabled: false, value: mod.default };
  }
  return out;
}

/** Build the combined directive from all enabled mods (post-history slot). */
export function modsDirective(resolved: Record<string, ModState>): string {
  const parts: string[] = [];
  let transforming = false;
  for (const mod of MODS) {
    const state = resolved[mod.id];
    if (!state?.enabled) continue;
    const text = mod.directive(state.value).trim();
    if (text) parts.push(text);
    if (mod.transformative) transforming = true;
  }
  if (!parts.length) return "";
  // A final character anchor lands closest to generation, keeping the character's
  // voice intact under whatever the enabled mods bend — but a transformative mod
  // (e.g. bimbofication, IQ loss) rewrites the voice on purpose, so we drop the
  // anchor rather than have it fight the transformation.
  if (!transforming) parts.push(CHARACTER_ANCHOR);
  return parts.join(" ");
}
