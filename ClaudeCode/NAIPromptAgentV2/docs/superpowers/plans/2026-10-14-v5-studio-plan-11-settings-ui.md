# Generation Settings UI — Plan 11 (sub-project 2 of 6)

> Executed inline. Approved in chat 2026-10-14 (user list + design canvas https://claude.ai/artifact/YHKCGgyUFzJJUVVjjeLQF1, boards 1–2).

**Goal:** a cleaner, more usable Studio: one-line generation summary that opens a settings sheet; resolution presets; sliders with numeric fields; seed clear; weight slider centred on "normal"; broom/trash icons; Positive/Negative tabs; position boxes where the selected one always wins.

## Global constraints
- Weight is still stored as the NovelAI weight (1 = normal). The UI shows the offset (weight − 1) on a −2…+2 slider centred at 0, ticks −2 · −1 · 0 · +1 · +2, the 0.8–1.3 "sweet spot" (−0.2…+0.3) shaded.
- Sizes are multiples of 64. Orientation presets: Portrait 2:3, Landscape 3:2, Square 1:1, Wallpaper (device aspect). Templates per orientation: Small / Medium / Large; plus Device (native screen pixels, rounded to 64 — costs Anlas). NovelAI web portrait sizes: 512×768, 832×1216, 1024×1536; square 640×640, 1024×1024, 1472×1472.
- Sliders: steps 0–50, guidance 0–10, rescale 0–1, each with a numeric field (typed values clamp).
- Line tools: broom = clear the line's text; trash = delete the line. Character "Remove" → trash. Icons inline SVG, `currentColor` (theme-reactive).
- Positive/Negative: Base card header tabs (Negative = base UC, replaces the separate Undesired content card); each character card the same (lines vs character UC). Tabs show a count.

## Review focus
1. Old drafts with odd sizes (not in any preset) → shown as Custom, nothing snaps silently.
2. Typed numbers out of range / empty → clamped on blur, never NaN sent.
3. Device size on desktop (no devicePixelRatio quirks) → sensible, multiple of 64.
4. Overlapping boxes: selecting via the numbered chips and dragging the active box's grip works even when another box covers it.
5. Weight offset round-trip: weight 1.15 ↔ +0.15; reset → undefined (unweighted).

## Tasks
1. `lib/sizes.ts` (presets, ratio label, device size, rotate) + tests.
2. `lib/weight.ts` (offset ↔ weight, labels) + tests.
3. `GenSettingsSheet` + summary row in ParamsBar.
4. Weight slider v2 + broom/trash in LineList; trash for character remove.
5. Positive/Negative tabs (Base card, character cards).
6. PositionCanvas: active box on top with a top-left move grip, numbered select chips.
7. Verify, review, deploy.
