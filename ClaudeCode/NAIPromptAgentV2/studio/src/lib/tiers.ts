// Model tiers: light features on small models, long RP/story on the heavy one.
export type Tier = "quick" | "everyday" | "heavy";
export const HEAVY_DEFAULT = "gemma4-26b-apex:latest";

/** The Ollama model for a tier: settings key `model.<tier>`, else the brain (quick/everyday) or APEX (heavy). */
export function tierModel(tier: Tier, get: (key: string) => string | null, brain: string): string {
  const v = get(`model.${tier}`)?.trim();
  return v || (tier === "heavy" ? HEAVY_DEFAULT : brain);
}

type Deps = {
  power: (action: "up" | "down") => Promise<{ ok: boolean; err: string }>;
  idleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/**
 * On 24 GB the heavy model only fits with the captioner and TIPO stopped and the everyday brain unloaded
 * (`power.sh down`). Heavy calls share one pause; servers come back after `idleMs` with no heavy call,
 * at once if a heavy call fails, or when a light feature needs them (`ensureLight`).
 * Only servers this gate paused are ever restarted.
 */
export class HeavyGate {
  state: "light" | "heavy" = "light";
  private users = 0;
  private timer: unknown = null;
  private pausing: Promise<void> | null = null;
  private idleMs: number;
  private setTimer: NonNullable<Deps["setTimer"]>;
  private clearTimer: NonNullable<Deps["clearTimer"]>;

  constructor(private deps: Deps) {
    this.idleMs = deps.idleMs ?? 10 * 60_000;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as NodeJS.Timeout));
  }

  private cancel() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private async restore() {
    this.cancel();
    if (this.state !== "heavy" || this.users > 0) return;
    this.state = "light";
    await this.deps.power("up");
  }

  async run<T>(fn: () => Promise<T>, onStatus?: (note: string) => void): Promise<T> {
    this.users++;
    this.cancel();
    let failed = false;
    try {
      if (this.state === "light") {
        const mine = !this.pausing;
        this.pausing ??= this.deps.power("down").then(() => { this.state = "heavy"; }).finally(() => { this.pausing = null; });
        await this.pausing;
        if (mine) onStatus?.("Paused captioner + TIPO for the heavy model");
      }
      return await fn();
    } catch (e) {
      failed = true;
      throw e;
    } finally {
      this.users--;
      if (this.users === 0) {
        if (failed) void this.restore();
        else this.timer = this.setTimer(() => void this.restore(), this.idleMs);
      }
    }
  }

  /** Before a captioner/TIPO/everyday-brain call. False while a heavy reply is running (no RAM to spare). */
  async ensureLight(): Promise<boolean> {
    if (this.pausing) await this.pausing;
    if (this.state === "light") return true;
    if (this.users > 0) return false;
    await this.restore();
    return true;
  }
}
