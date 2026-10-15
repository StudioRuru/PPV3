# Mascot stage, pill navigation & face-to-face chat — Design

> Approved in chat 2026-10-15. Sub-project 9. Phases: **P1** stage + pill nav, **P2** face-to-face chat, **P3** Dynamic Island (iOS shell, new Xcode build). ComfyUI moves to the next build.

## Goal
Miyabi stops being a corner sticker: her whole body lives on the screen in many poses, gets in the way on purpose (a welcome annoyance), and *is* the navigation; the Chat tab becomes sitting face to face with her; Aru's shop gets the same treatment.

## Decisions (from the owner)
- Full-body poses: **standing**, **lying down**, **A-pose**, **peeking**, **leaning**, **sitting**, **legs wide**, **back view** (looking at the content, hands on hips). Every pose × every expression × every outfit (back view: one per outfit — no face).
- Bottom tab bar removed; navigation = an in-app **pill** at the top (minimal / compact / expanded presentation states with invisible gesture zones) + Miyabi's tap menu.
- Chat tab opens fullscreen to Miyabi: persistent upper-body model on the **top 40%**, chat below. RP: she persists at the edge to spy/observe for her own enjoyment.
- Old Chat personas (Neutral director, Scene writer, Tag nerd, Bratty muse) are **removed** — Miyabi is the only face of the co-pilot.
- Attitudes become **sliders** (bratty, tease, flirt), saved per slime.
- Empty slime: her **face doesn't change** and every response is **"Data received."**
- Conversation sprites: a dedicated set to animate her thinking/talking and emotions in chat.

## 1. Sprite sets (P1 + P2)
Per character profile (`miyabi`, `aru`) with its own tag set (Aru: tags from the owner's description; editable).
- **Full-body poses (P1):** 8 poses; framing tags per pose; sizes stand/a-pose/peek/lean/back 832×1216, lie 1216×832, sit/legs-wide 1024×1024 (all ≤1 Mpx, 28 steps → free on Opus); `simple background, white background`; cut out via the tagger `/cutout`. Files `data/mascot/<spriteDir>/pose/<pose>/<outfit>/<expression>.png` (`back/<outfit>.png`). 7 posed × 9 × 3 + 3 = 192 per character.
- **Talk portraits (P2):** upper body (waist up), 1024×1024: 9 expressions + `think1`, `think2`, `talk_open`, `talk_closed`, `listen` per outfit.
- **Bust frames:** existing 27 stay for small spots (pill compact state).
- Studio: per character → per sprite kind (busts / poses / portraits) → outfit grid; "Generate missing" per pose or per outfit (one confirm, estimate shown, stops on first error); candidates pick as today; free-tier estimate shown.
- Fallbacks: missing pose/expression → same pose `smug` → standing → bust → placeholder.

## 2. Stage (P1)
- Miyabi is a full-body actor rendered as positioned DOM layers with CSS/Web Animations (no game engine). Size scales with the viewport (≈35–60% of screen height for standing on phones; size setting S/M/L kept).
- **Behaviour loop:** every 20–90 s (scaled by a **Mischief** slider 0–10) she picks a spot + pose: stand at an edge, lie along the bottom across content, sit on a card's top edge, peek from the left/right edge, lean on the image, A-pose in the middle (rare), turn her back to watch when a generation starts, legs-wide sit when bored (idle). Mischief 0 = parks at an edge and only moves when poked.
- **Obstruction rules:** she may cover content (that's the point) but never a focused input or the pill; while typing she ducks (slides to the nearest edge, peeking). Under sheets (z below `.sheet`), above content.
- **Microinteractions:** poke (tap body) → reaction expression + squash/jiggle + a quip chance; drag → picked-up flail (`shocked`) and drop where released (she settles into the nearest pose that fits); flick → thrown to an edge, bounces, sulks (`annoyed`), creeps back later; pat head (tap top 20%) → `flirty`/`laughing`; swipe off-screen → hidden for 10 min with a sulky line; scroll → sway; sheet opens → she peeks into it; generation done → turns around to judge it (quip).
- **Expressions on poses:** quip expression maps to the current pose's expression sprite; blink = brief swap to `sleepy` (2 frames) every few seconds; idle mood drifts.
- **Tap menu:** first tap on her (not a poke-zone gesture) opens a swipeable **speech-bubble carousel** of tabs (Studio · Camera roll · Closet · Chat · RP · Settings); swipe to choose, tap to go.

## 3. Pill navigation (P1)
- Floating pill at the top centre (below the status bar / real Dynamic Island area), replaces the bottom tab bar.
- **Minimal:** small handle with a dot in the current tab's colour. **Compact:** current tab name + Miyabi's mood bust. **Expanded:** tab switcher grid + Hide/Summon Miyabi + Mischief quick slider.
- **Gestures (invisible zones on the pill):** swipe left/right = previous/next tab; swipe down = expand; swipe up = collapse; tap = toggle compact/expanded; long-press = hide/summon Miyabi.
- Auto-collapses to minimal on scroll down, compact on scroll up. Edge-swipe between tabs (existing) kept.
- Layout: the app gains the bottom 3.5rem; composers stick to the bottom; `[data-composer]` logic unchanged.

## 4. Face-to-face chat (P2)
- **Chat tab = Miyabi:** top 40% portrait stage (her talk portraits; outfit by rules), below: chat (her threads, co-pilot patch cards, image attach) — the Miyabi sheet is removed (its features move here). Old personas removed from PERSONAS/UI; existing threads with removed personas are migrated to `miyabi`.
- Animation: user sends → `listen`; waiting → `think1`/`think2` loop; streaming → `talk_open`/`talk_closed` loop; done → reply's expression (from a `[expression]` tag Miyabi ends each deep-talk reply with, parsed like quips; default `smug`).
- **Aru's shop** uses the same layout with Aru's portraits.
- **RP spy:** in RP chats Miyabi appears at the edge (peek/lean pose) and occasionally (Mischief-scaled, ≤1 per 3 min) drops an observer quip about the scene (new event `rp_spy`, data = last two messages quoted, capped).
- **Attitude sliders:** `bratty` (= existing brat), `tease`, `flirt` sliders (0–10, value/cap) in the slime sliders; the toggles are removed; migration maps old toggles on → 6, off → 0.
- **Empty slime:** portrait/pose expression fixed to a neutral blank (no reaction changes, no blink), every quip and chat reply is exactly "Data received." with no model call.

## 5. Dynamic Island (P3, iOS shell)
- iOS doesn't deliver swipes on the real Dynamic Island; while the app is in the foreground its own Live Activity isn't shown there. So: the in-app pill covers foreground navigation; a **Live Activity** (ActivityKit widget extension, `ios/`) shows Miyabi when the app is backgrounded — compact (her mood bust + current tab), minimal (bust), expanded (interactive iOS 17 App-Intent buttons: Summon Miyabi, Hide Miyabi, open Studio/Chat). Buttons write to the app group and deep-link; the web app reads the intent via the existing JS bridge.
- Needs a new Xcode build + install on the phone (owner's device signing as before).

## 6. Error handling
- Missing sprites never break: fallback chain above; placeholder when nothing exists.
- Stage never blocks: a stuck drag releases on pointercancel; hidden state always recoverable from the pill (long-press) or Settings.
- Sprite generation: estimate first, confirm, stop on first error, nothing replaced on failure (existing studio rules).

## 7. Testing
- TDD: behaviour-loop chooser (spot/pose from screen layout + mischief + events), pose fallback chain, pill gesture classifier (swipe/tap/long-press thresholds), carousel selection, expression/animation state machine for chat (listen/think/talk/done/empty), slider migration (toggles → sliders), empty "Data received." path, rp_spy rate limit, persona removal migration.
- Live check on a scratch DB: stage poses render and move, pill gestures, Chat tab scene animating during a real reply, Aru shop layout, RP spy quip.

## Out of scope
ComfyUI (next build), Live2D/skeletal animation, sound.
