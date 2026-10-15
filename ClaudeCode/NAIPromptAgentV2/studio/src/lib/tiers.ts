// Model tiers: light features on small models, long RP/story on the heavy one.
export type Tier = "quick" | "everyday" | "heavy";
export const QUICK_DEFAULT = "hf.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF:Q4_K_M";
export const HEAVY_DEFAULT = "gemma4-26b-apex:latest";

/** The Ollama model for a tier: settings key `model.<tier>`, else the brain (everyday), QUICK_DEFAULT (quick) or APEX (heavy). */
export function tierModel(tier: Tier, get: (key: string) => string | null, brain: string): string {
  const v = get(`model.${tier}`)?.trim();
  return v || (tier === "heavy" ? HEAVY_DEFAULT : tier === "quick" ? QUICK_DEFAULT : brain);
}

type Deps = {
  power: (action: "up" | "down") => Promise<{ ok: boolean; err: string }>;
  /** Is anything the pause would stop running (brain loaded, captioner or TIPO up)? If not, the owner had it off: leave it off. */
  active?: () => Promise<boolean>;
  /** Unload the heavy model, so the captioner + TIPO don't start on top of it. */
  unloadHeavy?: () => Promise<void>;
  idleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/**
 * On 24 GB the heavy model only fits with the captioner and TIPO stopped and the everyday brain unloaded
 * (`power.sh down`). Heavy calls share one pause; servers come back after `idleMs` with no heavy call,
 * at once if a heavy call fails, or when a light feature needs them (`ensureLight`).
 * Only what was running when the gate paused is ever restarted; pause and restore never overlap.
 */
export class HeavyGate {
  state: "light" | "heavy" = "light";
  private users = 0;
  private timer: unknown = null;
  private pausing: Promise<void> | null = null;
  private restoring: Promise<void> | null = null;
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

  private restore(): Promise<void> {
    this.cancel();
    if (this.restoring) return this.restoring;
    if (this.state !== "heavy" || this.users > 0) return Promise.resolve();
    this.restoring = (async () => {
      await this.deps.unloadHeavy?.().catch(() => {});
      await this.deps.power("up");
      this.state = "light";
    })().finally(() => { this.restoring = null; });
    return this.restoring;
  }

  async run<T>(fn: () => Promise<T>, onStatus?: (note: string) => void): Promise<T> {
    this.users++;
    this.cancel();
    let failed = false;
    try {
      if (this.restoring) await this.restoring;
      if (this.state === "light") {
        const mine = !this.pausing;
        this.pausing ??= (async () => {
          if (this.deps.active && !(await this.deps.active())) return; // owner had them off: nothing to pause or restore
          await this.deps.power("down");
          this.state = "heavy";
        })().finally(() => { this.pausing = null; });
        await this.pausing;
        if (mine && (this.state as string) === "heavy") onStatus?.("Paused captioner + TIPO for the heavy model");
      }
      return await fn();
    } catch (e) {
      failed = true;
      throw e;
    } finally {
      this.users--;
      if (this.users === 0 && this.state === "heavy") {
        if (failed) void this.restore();
        else this.timer = this.setTimer(() => void this.restore(), this.idleMs);
      }
    }
  }

  /** Before a captioner/TIPO/everyday-brain call. False while a heavy reply is running (no RAM to spare). */
  async ensureLight(): Promise<boolean> {
    if (this.pausing) await this.pausing;
    if (this.restoring) await this.restoring;
    if (this.state === "light") return true;
    if (this.users > 0) return false;
    await this.restore();
    return true;
  }
}
