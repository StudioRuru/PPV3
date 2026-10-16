// The live mascot identity (what the active slime drives): stored in mascot settings + MascotStore on one db handle,
// so SlimeStore's transactions cover it. Server wiring (singletons, activeIdentity) lives in quip.ts.
import type Database from "better-sqlite3";
import { personaBlock } from "../persona";
import { driftSlider, EMPTY_BLOCK, lengthShape, sliderBlock, type Sliders } from "./slime";
import type { LiveIdentity, LiveState } from "./slime-store";
import { MASCOT_SETTINGS_KEY, mergeMascotSettings, parseMascotSettings, type MascotSettings } from "./settings";
import { MascotStore } from "./store";
import { validateAppliedVial, vialsBlock, type AppliedVial } from "./vial";

export type Identity = {
  empty: boolean; voice: string; selfName: string; sliders: Sliders; drift: number; lengthShape: ReturnType<typeof lengthShape>;
  vials: AppliedVial[];
};

/** What prompts need from settings; Empty ignores sliders and answers in one short burst. */
export function identityOf(s: MascotSettings, drift: number): Identity {
  const len = s.sliders.length;
  return {
    empty: s.empty, voice: s.voice, selfName: s.selfName || "the mascot", sliders: s.sliders, drift,
    lengthShape: lengthShape(s.empty ? 0 : len.live ?? len.value), vials: s.empty ? [] : s.vials,
  };
}

/** Miyabi's persona block: the slime's name + voice + slider directives + potion effects (quoted data), or EMPTY_BLOCK. deepTalk drops the quip length rule. */
export const slimePersona = (i: Identity, deepTalk = false): string =>
  i.empty ? EMPTY_BLOCK : [personaBlock("miyabi", i.drift, { name: i.selfName, voice: i.voice }), sliderBlock(i.sliders, i.selfName, { length: !deepTalk }), vialsBlock(i.vials)].filter(Boolean).join("\n");

export class DbIdentity implements LiveIdentity {
  constructor(private db: Database.Database, private store = new MascotStore(db)) {}

  settings(): MascotSettings {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(MASCOT_SETTINGS_KEY) as { value: string } | undefined;
    return parseMascotSettings(r?.value ?? null);
  }
  private patch(p: Record<string, unknown>): MascotSettings {
    const next = mergeMascotSettings(this.settings(), p);
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MASCOT_SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  active(drift: number): Identity { return identityOf(this.settings(), drift); }

  read(): LiveState {
    const s = this.settings();
    return {
      voice: s.voice, selfName: s.selfName, sliders: s.sliders, heatDrift: s.heatDrift,
      look: { charTags: s.charTags, constantTags: s.constantTags, layerTags: s.layerTags, exprTags: s.exprTags, spriteDir: s.spriteDir },
      memories: this.store.memories(), vials: s.vials,
    };
  }

  /** null = Empty (last look kept). Otherwise replaces voice/name/sliders/look and memories. */
  write(state: LiveState | null): void {
    if (!state) { this.patch({ empty: true }); return; }
    const { memories, look, ...rest } = state;
    // Replace whole fields: merge would silently keep old values on an invalid one, so check it took.
    const next = this.patch({ ...rest, ...look, empty: false });
    if (next.voice !== rest.voice || next.selfName !== rest.selfName || next.spriteDir !== look.spriteDir
      || JSON.stringify(next.vials) !== JSON.stringify(rest.vials.map(validateAppliedVial))) throw new Error("Invalid live identity");
    this.store.setMemories(memories);
  }

  /** Potion change on the active slime: only sliders + vials, memories untouched (write() would rewrite them). */
  setPotions(sliders: Sliders, vials: AppliedVial[]): void {
    const next = this.patch({ sliders, vials });
    if (JSON.stringify(next.vials) !== JSON.stringify(vials.map(validateAppliedVial))) throw new Error("Invalid live identity");
  }

  /** Owner ignored her / disliked a reply: nudge live sliders within caps. No-op when Empty. */
  drift(event: "idle" | "dislike"): void {
    const s = this.settings();
    if (!s.empty) this.patch({ sliders: driftSlider(s.sliders, event, s.heatDrift) });
  }
}
