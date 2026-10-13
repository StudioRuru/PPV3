import type { NaiParams } from "./nai-body";
import type { PromptState } from "./prompt";

export const DRAFT_KEY = "studio-draft-v1";
export type Draft = { state: PromptState; params: NaiParams };

/** Per-device convenience only; storage can be blocked (private mode), so never throw. */
export function loadDraft(): Draft | null {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); } catch { return null; }
}

export function saveDraft(d: Draft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
}
