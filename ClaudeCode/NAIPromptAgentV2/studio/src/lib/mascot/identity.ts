// The live mascot identity (what the active slime drives): stored in mascot settings + MascotStore on one db handle,
// so SlimeStore's transactions cover it. Server wiring (singletons, activeIdentity) lives in quip.ts.
import type Database from "better-sqlite3";
import { personaBlock, type Modifiers } from "../persona";
import { driftSlider, EMPTY_BLOCK, lengthShape, sliderBlock, type Sliders } from "./slime";
import type { LiveIdentity, LiveState } from "./slime-store";
import { MASCOT_SETTINGS_KEY, mergeMascotSettings, parseMascotSettings, type MascotSettings } from "./settings";
import { MascotStore } from "./store";

export type Identity = {
  empty: boolean; voice: string; selfName: string; sliders: Sliders; mods: Modifiers; drift: number; lengthShape: ReturnType<typeof lengthShape>;
};

const MODS = ["bratty", "tease", "flirt"] as const;

/** What prompts need from settings; Empty ignores sliders/mods and answers in one short burst. */
export function identityOf(s: MascotSettings, drift: number): Identity {
  const len = s.sliders.length;
  return {
    empty: s.empty, voice: s.voice, selfName: s.selfName || "the mascot", sliders: s.sliders, mods: s.empty ? {} : s.mods, drift,
    lengthShape: lengthShape(s.empty ? 0 : len.live ?? len.value),
  };
}

/** Miyabi's persona block: the slime's name + voice + slider directives, or EMPTY_BLOCK. */
export const slimePersona = (i: Identity): string =>
  i.empty ? EMPTY_BLOCK : [personaBlock("miyabi", i.mods, i.drift, { name: i.selfName, voice: i.voice }), sliderBlock(i.sliders, i.selfName)].filter(Boolean).join("\n");

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
      mods: Object.fromEntries(MODS.filter((k) => s.mods[k]).map((k) => [k, true])),
      look: { charTags: s.charTags, constantTags: s.constantTags, layerTags: s.layerTags, exprTags: s.exprTags, spriteDir: s.spriteDir },
      memories: this.store.memories(),
    };
  }

  /** null = Empty (last look kept). Otherwise replaces voice/name/sliders/mods/look and memories. */
  write(state: LiveState | null): void {
    if (!state) { this.patch({ empty: true }); return; }
    const { memories, look, mods, ...rest } = state;
    // Replace whole fields: merge would silently keep old values on an invalid one, so check it took.
    const next = this.patch({ ...rest, ...look, mods: Object.fromEntries(MODS.map((k) => [k, mods[k] === true])), empty: false });
    if (next.voice !== rest.voice || next.selfName !== rest.selfName || next.spriteDir !== look.spriteDir) throw new Error("Invalid live identity");
    this.store.setMemories(memories);
  }

  /** Owner ignored her / disliked a reply: nudge live sliders within caps. No-op when Empty. */
  drift(event: "idle" | "dislike"): void {
    const s = this.settings();
    if (!s.empty) this.patch({ sliders: driftSlider(s.sliders, event, s.heatDrift) });
  }
}
