# Camera Roll + Tab Bar — Plan 12 (sub-project 3 of 6)

> Executed inline. Approved in chat 2026-10-14 (user list + design canvas boards 1, 3a, 3b, 4).

**Goal:** a bottom tab bar (Studio · Camera roll · Closet · Chat) with swipe between tabs; a Camera roll grid with filters, multi-select, zip to Files, delete selected and Clear all; auto-delete after 1/2/3 days or never; a floppy-disk overlay when saving; upscale size options with MB; NovelAI PNG import at the top.

## Global constraints
- Swipe: horizontal swipe on free page areas switches Studio ↔ Camera roll ↔ Closet. Never starts on `[data-noswipe]`, inputs, textareas, selects, range sliders, the Tagger pane, the position canvas, images in the roll, or open sheets. Commit: |dx| > 56 px, |dx| > 2·|dy|, under 450 ms.
- Chat stays a sheet for now (sub-project 5 makes it a screen); its tab opens the sheet. Closet is a placeholder screen pointing to Building blocks until sub-project 4.
- Deleting is permanent (rows + PNG files). "Clear all" and "Delete selected" always confirm in-app (no window.confirm). Auto-delete default: Never; stored server-side (`settings` table), applied on server start, hourly, and when history is listed.
- Upscale scale 2× or 4× (NovelAI `scale`); estimated MB shown before, real MB after.
- The Strength grid moves into the Generate bar as a button.

## Review focus
1. Swipe must not fire while scrolling vertically, dragging a slider, selecting text, or inside the canvas/Tagger.
2. Delete/clear while the current image or viewer shows a deleted image → falls back cleanly.
3. Auto-delete never removes images newer than the window; "never" deletes nothing; clock/timezone safe (uses created_at ms).
4. Upscale 2× on an image where NovelAI rejects scale 2 → readable error, no row saved.
5. Zip of a filtered selection matches what's shown.

## Tasks
1. `lib/retention.ts` (expired ids) + settings table + cleanup. Tests.
2. `DELETE /api/generations` (ids | all) + `/api/settings`.
3. Tab bar + swipe (`lib/swipe.ts` decision function, tested) + page restructure.
4. Camera roll screen (grid, filters, select, zip, delete, clear all, confirm).
5. Save floppy overlay; upscale scale options + MB; Import NovelAI PNG in the header; Settings auto-delete.
6. Verify, review, deploy, rebuild iOS if needed.
