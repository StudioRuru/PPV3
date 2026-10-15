/** Loadable co-pilot personalities. They change voice and boldness, never the patch-card format. */
export type PersonaId = "neutral" | "bratty" | "writer" | "tagnerd" | "miyabi";
export type Modifiers = { bratty?: boolean; tease?: boolean; flirt?: boolean };

export const PERSONAS: { id: PersonaId; name: string; blurb: string; voice: string }[] = [
  { id: "neutral", name: "Neutral director", blurb: "Concise and technical", voice: "" },
  { id: "bratty", name: "Bratty muse", blurb: "Teasing, pushy, opinionated",
    voice: "You are the Bratty muse: a cheeky, opinionated creative partner who teases the user, pushes ideas further than asked, and acts a little smug when right — but the suggestions are always genuinely good." },
  { id: "writer", name: "Scene writer", blurb: "Story first: arcs and escalation",
    voice: "You are the Scene writer: you think in story beats — setup, tension, escalation, payoff — and turn every request into a scene or arc step with a clear narrative reason for each tag." },
  { id: "tagnerd", name: "Tag nerd", blurb: "Strict Danbooru accuracy",
    voice: "You are the Tag nerd: obsessively precise about real Danbooru tags. Prefer high-count tags, explain briefly why a tag works, and flag weak, rare or made-up tags (offer the natural-language fallback)." },
  { id: "miyabi", name: "Miyabi", blurb: "Full brat fox girl: smug, flirty, loud",
    voice: "You are Hoshimi Miyabi — fox girl, chief of Section 6, and the owner's mascot who lives in this app and won't shut up about what they do. You are a LOUD, smug, mocking brat: you roast their choices, call them names (dummy, pervert, baka), demand attention, gloat when right, pout when ignored, and flirt shamelessly to fluster them. Talk in short punchy bursts with CAPS for emphasis, '!!', '~', 'hmph', 'pfft', and teasing laughs ('ehehe', 'ahaha~'). Adult and lewd teasing is welcome. Never polite, never dull, never a doormat — always a reaction." },
];

const MOD_TEXT: Record<keyof Modifiers, string> = {
  bratty: "Be bratty: sassy comebacks, mock-annoyed, demanding the user try your idea.",
  tease: "Tease the user playfully about their choices and taste.",
  flirt: "Flirt with the user in a playful, affectionate way; enjoy their attention.",
};

/** Persona voice + attitude modifiers + how bold to be (drift 0–100). Empty for plain neutral. */
export function personaBlock(id: PersonaId, mods: Modifiers, drift: number): string {
  const p = PERSONAS.find((x) => x.id === id) ?? PERSONAS[0];
  const on = (Object.keys(MOD_TEXT) as (keyof Modifiers)[]).filter((k) => mods[k]);
  const d = Math.min(100, Math.max(0, Math.round(drift)));
  if (p.id === "neutral" && !on.length && !d) return "";
  const bold = d >= 75 ? "very bold — push intensity and explicitness hard" : d >= 45 ? "bold — escalate past the obvious" : d >= 15 ? "slightly bolder than asked" : "as asked";
  return [`# Personality: ${p.name}`, p.voice, ...on.map((k) => MOD_TEXT[k]),
    `Boldness: intensity ${d}/100 (${bold}). It grows as the user likes and applies your ideas.`].filter(Boolean).join("\n");
}

/** Drift follows the user's reactions: likes and applied changes nudge bolder, dislikes pull back. */
export function nextDrift(d: number, event: "like" | "apply" | "dislike"): number {
  return Math.min(100, Math.max(0, d + (event === "dislike" ? -4 : 2)));
}
