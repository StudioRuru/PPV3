# Gallery, Themes, Settings, Polish — Implementation Plan (Plan 9)

> Executed inline (Native) after Plan 8. Design approved in chat 2026-10-14.

**Goal:** full-screen viewer, zip export, five themes + custom accent, a Settings sheet, native-feeling sheets, and the deferred minors.

## Global constraints
- Themes: `night` (default), `darkroom` (amber), `console` (mint, more mono), `daylight` (light), `pink` (cute egirl pastel, hot-pink accent). Custom accent overrides `--color-accent` (+ derived fg/soft). Stored per device (localStorage, try/catch), applied by an inline head script before paint; `theme-color` meta follows.
- Every hard-coded colour that breaks a light theme moves to a token.
- Zip export: `/api/export` (today | last N | ids), stored (no recompression) PNGs with recipes intact, `Content-Disposition: attachment`. iOS shell turns attachment responses into a share sheet (WKDownload).
- Viewer: tap preview/thumb → full screen; swipe between history; pinch + double-tap zoom; Save / Variations / Upscale / Reuse.
- Settings sheet: theme, accent, generation defaults (sampler, schedule, rescale — used for new drafts), position words, Anlas balance, Danbooru key configured y/n.
- Sheets: swipe down on the header to close, body scroll lock while open, focus moves into the sheet and back.
- Minors: Find "More" uses the submitted query + stale-response guard; Recreate keeps chip weights; Undo clears after a later edit.

## Review focus
1. Theme script with storage blocked → default theme, no crash, no flash.
2. Export of 0 matches / huge selection → clear message; zip streams within memory.
3. Viewer on the newest/oldest image, single image, upscaled 13-Mpx image (memory).
4. Swipe-to-close must not fight inner scrolling (only from the header/handle).
5. iOS download of the zip lands in a share sheet; non-attachment navigations unchanged.

## Tasks
1. Theme tokens + `lib/theme.ts` (pure: accent → fg/soft) + head script. Tests.
2. Settings sheet (theme, accent, defaults, position words, Anlas, Danbooru status `/api/status`).
3. Sheet polish (swipe, scroll lock, focus).
4. Viewer.
5. Export: `lib/export` selection (test) + `/api/export` + ExportSheet; iOS WKDownload → share sheet.
6. Minors.
7. Verify, review, deploy, rebuild iOS app.
