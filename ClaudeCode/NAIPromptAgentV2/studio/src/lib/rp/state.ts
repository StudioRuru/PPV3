// Dynamic story state (ported from Delfino src/lib/types.ts).
/**
 * An inferred starting value for a dynamic story variable (mood, relationship
 * level, outfit, location…), produced by the conversation analyzer. Carried
 * through the wizard to seed the dynamic-state layer (Milestone 4).
 */
export interface StateSeed {
  label: string;
  value: string;
}

/* ----------------------------- dynamic state ----------------------------- */

export type StateVarType = "meter" | "number" | "text" | "enum";

/**
 * One dynamic story variable defined on a character card. Its live value is
 * tracked per-chat (see chats.stateValues) and evolves as the story does.
 */
export interface StateVariable {
  /** Stable machine id (used as the key in stateValues). */
  id: string;
  label: string;
  type: StateVarType;
  initial: string | number;
  /** For meter/number. */
  min?: number;
  max?: number;
  /** For enum. */
  options?: string[];
  description?: string;
}

/** Live values keyed by variable id. */
export type StateValues = Record<string, string | number>;

/** Default bounds for a meter that doesn't specify its own. */
export const METER_MIN = 0;
export const METER_MAX = 100;

function slugifyStateId(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "var";
}

/** Parse and sanitise a character's stateSchema JSON into StateVariable[]. */
export function parseStateSchema(json: string | null | undefined): StateVariable[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: StateVariable[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!label) continue;
    const type: StateVarType =
      o.type === "meter" || o.type === "number" || o.type === "enum" ? o.type : "text";
    let id = typeof o.id === "string" && o.id.trim() ? slugifyStateId(o.id) : slugifyStateId(label);
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const options =
      Array.isArray(o.options)
        ? o.options.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
        : undefined;
    const min = typeof o.min === "number" ? o.min : undefined;
    const max = typeof o.max === "number" ? o.max : undefined;
    const initial =
      typeof o.initial === "number" || typeof o.initial === "string" ? o.initial : type === "meter" || type === "number" ? 0 : "";
    out.push({
      id,
      label,
      type,
      initial,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(options && options.length ? { options } : {}),
      ...(typeof o.description === "string" && o.description.trim() ? { description: o.description.trim() } : {}),
    });
  }
  return out;
}

/** Parse a chat's stateValues JSON into a plain record. */
export function parseStateValues(json: string | null | undefined): StateValues {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: StateValues = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "string") out[k] = v;
  }
  return out;
}

const clampNum = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Bounds for a variable, applying meter defaults. */
function boundsFor(v: StateVariable): { min: number; max: number } | null {
  if (v.type === "meter") return { min: v.min ?? METER_MIN, max: v.max ?? METER_MAX };
  if (v.type === "number" && (v.min !== undefined || v.max !== undefined)) {
    return { min: v.min ?? -Infinity, max: v.max ?? Infinity };
  }
  return null;
}

/**
 * Reconcile raw values against the schema: fill missing from `initial`, coerce
 * types, clamp meters/numbers to range, snap enums to their options, and drop
 * any keys the schema doesn't define. Always returns a value for every variable.
 */
export function clampStateValues(schema: StateVariable[], values: StateValues): StateValues {
  const out: StateValues = {};
  for (const v of schema) {
    const raw = values[v.id] ?? v.initial;
    if (v.type === "meter" || v.type === "number") {
      let n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(n)) n = typeof v.initial === "number" ? v.initial : 0;
      const b = boundsFor(v);
      if (b) n = clampNum(n, b.min, b.max);
      out[v.id] = n;
    } else if (v.type === "enum") {
      const s = String(raw);
      out[v.id] = v.options && v.options.includes(s) ? s : (v.options?.[0] ?? String(v.initial));
    } else {
      out[v.id] = String(raw);
    }
  }
  return out;
}

/** Initial values for a fresh chat, straight from the schema's `initial`s. */
export function initialStateValues(schema: StateVariable[]): StateValues {
  return clampStateValues(schema, {});
}

/**
 * The `[Current state]` block injected near generation. Pure string builder;
 * the caller applies macro substitution. Returns "" when there's no state.
 */
export function stateBlock(schema: StateVariable[], values: StateValues): string {
  if (!schema.length) return "";
  const clamped = clampStateValues(schema, values);
  const lines = schema.map((v) => {
    const val = clamped[v.id];
    if (v.type === "meter") {
      const max = v.max ?? METER_MAX;
      return `- ${v.label}: ${val}/${max}`;
    }
    return `- ${v.label}: ${val}`;
  });
  return `[Current state — keep the scene consistent with these; they shift as the story does:]\n${lines.join("\n")}`;
}
