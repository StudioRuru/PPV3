// RP spy: when Miyabi may drop an observer quip about the roleplay (pure; rand/now injected).
export const SPY_GAP_MS = 3 * 60_000;
const QUOTE_MAX = 600;

/** At most one per 3 min; mischief 0 = never, else chance = mischief/10 x 0.5. */
export function spyDue(now: number, lastSpyAt: number, mischief: number, rand: () => number): boolean {
  if (mischief <= 0 || now - lastSpyAt < SPY_GAP_MS) return false;
  return rand() < (Math.min(mischief, 10) / 10) * 0.5;
}

/** The last two RP messages, trimmed, joined and capped; sent as quoted data. */
export function spyData(messages: { content: string }[]): { quote: string } {
  return { quote: messages.slice(-2).map((m) => m.content.trim()).join("\n").slice(0, QUOTE_MAX) };
}
