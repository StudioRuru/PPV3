# Apothecary — Plan 18 (sub-project 8, P2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (owner's choice). Steps are TDD: write the named tests, watch them fail, implement, watch them pass, commit.

**Goal:** A shop door on the slime shelf opens Aru's Apothecary — a chat with an adult catgirl alchemist who brews **vials** from the owner's requests. Vials are bottled into an inventory and dropped into slime jars, permanently adding an effect text and nudging sliders; a **Neutral vial** (always in stock) undoes every vial on a jar.

**Architecture:** Pure vial logic in `studio/src/lib/mascot/vial.ts` (parse Aru's fenced vial block, validate, apply to a slime doc with recorded deltas, neutralise, prompt block); inventory in `mascot_vials` (`vial-store.ts`); the live identity gains `vials` so effects reach quips/deep talk; persona `aru` (hidden from the Chat picker) runs on the everyday brain through the existing Chat 2.0 route; API `/api/mascot/vials`; UI `ApothecarySheet` opened from the shelf.

**Tech stack:** Next.js 16, better-sqlite3, node:test via tsx (`cd studio && npm test`), Ollama (everyday 12B for Aru, E4B for reaction quips).

**Spec:** `docs/superpowers/specs/2026-10-15-slimes-sliders-apothecary-design.md` §3 (+ §1–2 for slimes/sliders).

## Global constraints
- Branch `apothecary`; commit only named files with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push; git root is HOME — never `git add -A`.
- No live NovelAI/Ollama/tagger calls in tests; no dev server unless the controller runs it on a scratch DB copy; never write the real `data/`.
- Vial: `{ name ≤40, color #rrggbb, effect ≤300 chars, sliders?: { <brat|bimbo|hypnosis|heat|length>: { value?: int −3…+3, cap?: int −3…+3 } } }`; unknown keys dropped; invalid → rejected with a readable reason.
- A jar holds ≤ 8 vials; applying records the deltas actually applied (after clamping to 0–10 and cap ≥ value) so the Neutral vial reverts them exactly.
- Vial effects enter prompts as quoted data ("Potion effects (data): …"), capped (≤ 8 × 300 chars).
- Aru: adult catgirl alchemist — teasing, erotic, provocatively dressed, exhibitionist; cat-bell collar, blue leash, gold earrings, cow tag on one ear, droopy eyes; shy, nervous, fidgety, introverted; staff-sized cauldron spoon; rarely stutters, mostly when excited. NSFW allowed. Runs on the everyday brain (not APEX).
- Dropping a vial consumes it from the inventory; the Neutral vial is never consumed or deletable.

## Review focus
1. Apply/neutralise round-trip: applying N vials then Neutral restores sliders exactly (incl. clamped deltas and cap ≥ value), clears vials, and keeps drift rules intact.
2. Active-jar consistency: dropping into the active jar updates both the jar doc and the live identity in one transaction; dropping into an inactive jar never touches the live identity.
3. Aru's output is untrusted text: a malformed/oversized/hostile vial block is rejected or capped; effect text is quoted data in Miyabi's prompts and can't break the persona or format rules.
4. Inventory: bottle/discard/drop are idempotent under double taps (no duplicate vials, no double consumption); the 8-vial jar limit gives a readable error.
5. Aru stays out of the co-pilot: hidden from the Chat tab's persona picker and default thread pick (like Miyabi).

---

### Task 1: Vial core (pure)
**Files:** Create `studio/src/lib/mascot/vial.ts`, `vial.test.ts`.

**Produces:** `type Vial = { name; color; effect; sliders?: Partial<Record<SliderId, { value?: number; cap?: number }>> }`; `type AppliedVial = Vial & { applied: Partial<Record<SliderId, { value: number; cap: number }>> }`; `NEUTRAL_VIAL` (name "Neutral vial", grey, effect "Undoes every potion in this jar"); `validateVial(raw): { ok: true; vial: Vial } | { ok: false; reason: string }`; `parseVialBlock(text): Vial | null | { error: string }` (finds the last fenced ```vial … ``` block, JSON-parses, validates); `applyVial(doc: SlimeDoc, v: Vial): { doc: SlimeDoc } | { error: string }` (≤8 vials; applies deltas to value then cap with clamping and cap ≥ value; records applied deltas; clears live on touched sliders); `neutralize(doc): SlimeDoc` (reverts applied deltas newest→oldest, clamped, clears vials); `vialsBlock(vials: AppliedVial[]): string` (quoted "Potion effects (data)" list, capped).

**Tests:** validation (bad colour, long effect, unknown slider, out-of-range delta, non-object); parse from chatty text with a fenced block, two blocks (last wins), no block → null, broken JSON → error; apply clamps at 0/10 and keeps cap ≥ value and records actual deltas; 9th vial refused; apply ×3 then neutralize restores the original sliders exactly (property-style over a few fixed cases incl. clamped ones); vialsBlock quotes and caps.

Commit: `feat(apothecary): vial core`.

### Task 2: Inventory + live identity carries vials
**Files:** Create `studio/src/lib/mascot/vial-store.ts`, `vial-store.test.ts`; Modify `studio/src/lib/db.ts` (migrate), `lib/mascot/slime-store.ts` (LiveState gains `vials`), `lib/mascot/identity.ts` (DbIdentity reads/writes `vials` in mascot settings; `slimePersona` appends `vialsBlock`), `lib/mascot/settings.ts` (validated `vials` field, ≤8, each via validateVial + applied), `lib/mascot/slime.ts` (`validateSlime` validates vials as AppliedVial).

**Produces:** `migrateVials(db)` (`mascot_vials(id, doc, created_at)`); `VialStore(db)`: `list()`, `bottle(v: Vial): number`, `discard(id)`, `take(id): Vial | null` (delete + return in one statement/transaction).
- Dropping into a jar (implemented in Task 4) uses `SlimeStore.save` for inactive jars and, for the active jar, the store's transaction writing both doc and live identity.

**Tests:** bottle/list/discard; take is single-use (second take → null); LiveState round-trip includes vials; slimePersona includes the potion block (quoted) when vials exist and omits it otherwise; Empty identity ignores vials; validateSlime keeps valid applied vials and drops invalid ones.

Commit: `feat(apothecary): vial inventory + vials in the live identity`.

### Task 3: Aru persona
**Files:** Modify `studio/src/lib/persona.ts` (add `aru` with the Global constraints description; brewing rule: when the owner asks for a potion, stay in character and end the reply with one fenced ```vial JSON block using the exact schema; otherwise no block), `components/ChatScreen.tsx` + `lib/threads-pick.ts` (hide/skip `aru` like `miyabi`), `lib/chat-model.ts` (aru → everyday brain, default options; no slime identity).

**Tests:** personaBlock("aru") contains the schema keys, the slider names and the delta range; threads-pick skips aru threads and never inherits aru; modelFor("aru") → undefined (everyday).

Commit: `feat(apothecary): Aru persona`.

### Task 4: Vials API (+ reaction quips)
**Files:** Create `studio/src/app/api/mascot/vials/route.ts`, `studio/src/lib/mascot/vial-api.ts` (pure handler with injected deps), tests; Modify `lib/mascot/core.ts` / `prompt.ts` (event kind `vial_drop` with hint "A potion was just poured into your jar: <effect> — react in character, feel it take hold").
- `GET` → `{ vials: [{ id, …vial }], neutral: NEUTRAL_VIAL }`.
- `POST { action: "bottle", vial }` (validate) → id; `{ action: "parse", text }` → parsed vial or error (UI convenience for Aru replies); `{ action: "discard", id }`; `{ action: "drop", id, jarId }` → take + applyVial + save (active jar: doc + live in one transaction; take is rolled back if apply fails) → returns jar + (active only) a `vial_drop` quip; `{ action: "neutral", jarId }` → neutralize + save (active: live too) → quip for the active jar.

**Tests:** drop into inactive jar never touches live; drop into active updates both; apply failure (9th vial) returns the vial to the inventory; double drop of the same vial id → second fails cleanly; neutral restores sliders exactly through the API; unknown action/ids → 400.

Commit: `feat(apothecary): vials API`.

### Task 5: Apothecary UI
**Files:** Create `studio/src/components/mascot/ApothecarySheet.tsx`, `VialCard.tsx` (SVG potion bottle tinted by colour); Modify `SlimeShelf.tsx` (a shop door button "Aru's Apothecary"; jar badge with vial count; jar action "Potions" listing applied vials + "Pour the Neutral vial" with confirm), `Mascot.tsx` (nothing new beyond existing `mascot:say`/`mascot:identity`).
- Sheet: Aru header (lettered placeholder avatar "A" in blue with a bell icon; sprite support later), chat stream with an `aru` thread (most recent or create), message rendering via `Md`; when a reply contains a vial block, show a VialCard (name, colour, effect, slider deltas as chips) with **Bottle it**; inventory row of bottles; tapping a bottle → Drop into… (jar picker incl. active jar badge) or Discard; the Neutral vial always shown.
- Network actions disabled while in flight; failures inline; 44px targets; fits 390px.
- Pure helpers (delta chip labels, vial list sorting) with tests.

Commit: `feat(apothecary): shop UI`.

### Task 6: Verify, review, ship
- `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Controller live check on a scratch DB copy: Aru brews one vial on the 12B (fenced block parsed), bottle it, drop into the active jar (Miyabi reacts; slider moved), Neutral restores; a malformed vial is rejected; shop renders.
- Final whole-branch review (Opus) with the Review focus; one fix wave; merge `apothecary` → main (ff); `npm run deploy`.
