// Pure, shared by the web Stage player and the Mac overlay (bundled by scripts/build-behaviour.mjs). No DOM / node imports.
import { allowedKeys, type Boldness, type Library } from "./core";

export type Ev = { type: "tick" } | { type: "poke" } | { type: "dragStart" } | { type: "drop" } | { type: "typing" } | { type: "sysIdle" } | { type: "sysActive" };
// lastLook is optional so the overlay's state JSON stays as the brief shapes it
export type BState = { pose: string; since: number; lastUser: number; pokes: number[]; nextDrift: number; asleep: boolean; dragging: boolean; lastLook?: number };
export type Act = { pose: string; quip?: "poke" | "tease" | "make_me" | "finally" | "ignored"; look?: "cursor" };
export type Ctx = { lib: Library; outfit: string; boldness: Boldness; now: number; rand: () => number };

const S = 1000, MIN = 60 * S;
const drift = (now: number, rand: () => number) => now + 20 * S + Math.floor(rand() * 40 * S);
const pick = <T>(a: T[], rand: () => number): T | undefined => a[Math.floor(rand() * a.length)];

export const init = (pose: string, now: number, rand: () => number): BState => ({ pose, since: now, lastUser: now, pokes: [], nextDrift: drift(now, rand), asleep: false, dragging: false });

/** BFS over undirected edges, inclusive of both ends; [] when unreachable. */
export function path(edges: [string, string][], from: string, to: string): string[] {
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]); }
  const prev = new Map<string, string | null>([[from, null]]);
  for (const q = [from]; q.length; ) {
    const c = q.shift()!;
    if (c === to) { const p: string[] = []; for (let n: string | null = c; n != null; n = prev.get(n)!) p.unshift(n); return p; }
    for (const n of adj.get(c) ?? []) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
  }
  return [];
}

export function step(s: BState, ev: Ev, c: Ctx): { s: BState; act: Act | null } {
  const { now, rand } = c;
  const stage = c.lib.keys.filter((k) => k.surface === "stage");
  const ok = allowedKeys(stage, c.boldness, c.outfit);
  const has = (key: string) => ok.some((k) => k.key === key);
  const tagged = (...t: string[]) => ok.filter((k) => t.some((x) => k.tags.includes(x)));
  const names = new Set(ok.map((k) => k.key)).add(s.pose);
  // next hop toward `to` over allowed poses only; the player crossfades if the clip isn't approved
  const hop = (to: string) => path(c.lib.edges.filter(([a, b]) => names.has(a) && names.has(b)), s.pose, to)[1] ?? s.pose;
  const move = (n: BState, pose: string, act: Omit<Act, "pose"> = {}): { s: BState; act: Act } => ({ s: { ...n, pose, since: pose === n.pose ? n.since : now }, act: { pose, ...act } });
  const none = (n: BState = s) => ({ s: n, act: null });

  switch (ev.type) {
    case "tick": {
      if (s.asleep || s.dragging || now < s.nextDrift) return none();
      const n = { ...s, nextDrift: drift(now, rand) };
      const ignored = now - s.lastUser;
      const hi = ignored >= 15 * MIN ? tagged("tease", "lewd") : ignored >= 5 * MIN ? tagged("tease") : [];
      const t = pick(hi.filter((k) => k.key !== s.pose), rand);
      if (t) return move(n, hop(t.key), { quip: "ignored" });
      const nb = c.lib.edges.flatMap(([a, b]) => (a === s.pose ? [b] : b === s.pose ? [a] : []));
      const calm = ok.filter((k) => nb.includes(k.key) && (k.tags.includes("rest") || !k.tags.length));
      const d = pick(calm, rand);
      return d ? move(n, d.key) : none(n);
    }
    case "poke": {
      const pokes = [...s.pokes.filter((t) => now - t < 10 * S), now];
      const n = { ...s, pokes: pokes.length >= 3 ? [] : pokes, lastUser: now, asleep: false, nextDrift: drift(now, rand) };
      if (pokes.length >= 3) { const t = pick(tagged("tease"), rand); return move(n, t ? hop(t.key) : s.pose, { quip: "make_me" }); }
      const r = pick(tagged("reaction"), rand);
      return move(n, r ? hop(r.key) : s.pose, { quip: "poke" });
    }
    case "dragStart": return move({ ...s, dragging: true, lastUser: now }, has("dangle") ? "dangle" : s.pose);
    case "drop": return move({ ...s, dragging: false, lastUser: now, nextDrift: drift(now, rand) }, has("sit") ? "sit" : s.pose);
    case "typing": {
      const n = { ...s, lastUser: now };
      if (now - (s.lastLook ?? -Infinity) < 30 * S) return none(n);
      return move({ ...n, lastLook: now }, s.pose, { look: "cursor" });
    }
    case "sysIdle": return move({ ...s, asleep: true }, has("lie_down") ? "lie_down" : s.pose);
    case "sysActive": {
      const n = { ...s, lastUser: now, asleep: false, nextDrift: drift(now, rand) };
      return s.asleep ? move(n, has("stand") ? "stand" : s.pose, { quip: "finally" }) : none(n);
    }
    default: return none();
  }
}

const EVS = new Set(["tick", "poke", "dragStart", "drop", "typing", "sysIdle", "sysActive"]);
/** Overlay entry: JSON {s, ev, ctx:{lib, outfit, boldness, now}} in, JSON {s, act} out; never throws. */
export function toJSONStep(json: string): string {
  let s: BState | null = null;
  try {
    const i = JSON.parse(json);
    s = i?.s ?? null;
    if (!s || typeof s !== "object") throw new Error("bad s");
    if (!EVS.has(i.ev?.type)) throw new Error("bad ev");
    if (!i.ctx?.lib || !Number.isFinite(i.ctx.now)) throw new Error("bad ctx");
    const rand = typeof i.ctx.rand === "function" ? i.ctx.rand : Math.random;
    return JSON.stringify(step(s, i.ev, { ...i.ctx, rand }));
  } catch (e) {
    return JSON.stringify({ s: s && typeof s === "object" ? s : null, act: null, error: String(e) });
  }
}
