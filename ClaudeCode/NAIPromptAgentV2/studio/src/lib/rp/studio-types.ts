// Character-studio shapes, ported from Delfino Plaza src/lib/types.ts.

export interface StagedEntry {
  /** Short label for the review UI. Never prompted. */
  name: string;
  keys: string[];
  content: string;
  position: "before" | "after";
  constant: boolean;
}

export interface StagedVoiceLine {
  text: string;
  context: string;
}

export interface WikiHit {
  title: string;
  url: string;
}

export interface StateSeed {
  label: string;
  value: string;
}

export interface ResearchModifiers {
  /** How closely to hew to canon vs. reinterpret. */
  faithfulness: "canon" | "balanced" | "reinterpret";
  /** Optional overall tone to lean into ("" = leave as canon implies). */
  tone: "" | "wholesome" | "flirty" | "dark" | "comedic";
  /** How the character relates to the user ("" = leave unspecified). */
  relationship: "" | "stranger" | "friend" | "partner" | "rival";
}

export const DEFAULT_RESEARCH_MODIFIERS: ResearchModifiers = {
  faithfulness: "canon",
  tone: "",
  relationship: "",
};

/** Coerce loose input into valid ResearchModifiers, falling back to defaults. */
export function coerceResearchModifiers(v: unknown): ResearchModifiers {
  const o = (v ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(val: unknown, allowed: readonly T[], fallback: T): T =>
    typeof val === "string" && (allowed as readonly string[]).includes(val) ? (val as T) : fallback;
  return {
    faithfulness: pick(o.faithfulness, ["canon", "balanced", "reinterpret"] as const, "canon"),
    tone: pick(o.tone, ["", "wholesome", "flirty", "dark", "comedic"] as const, ""),
    relationship: pick(o.relationship, ["", "stranger", "friend", "partner", "rival"] as const, ""),
  };
}

export interface StudioCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  alternateGreetings: string[];
  tags: string[];
  /** Suggested structural locks — an allowed value, or "" for no lock. */
  povMode: string;
  tense: string;
  dialogueStyle: string;
  /** Quotable lines in the character's own voice, for the retrieval voice pool. */
  voiceLines: { text: string; context: string }[];
}

