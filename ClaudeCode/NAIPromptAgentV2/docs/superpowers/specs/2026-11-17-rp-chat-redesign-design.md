# RP chat redesign + native polish — design

Date: 2026-11-17 · Status: draft for approval

## Why

The iPhone app (WKWebView shell `ios/App/StudioApp.swift` around the Next.js studio on :3100) works but feels like a web page. The RP chat screen (`studio/src/components/rp/RpChat.tsx`) is the biggest pain point. The owner named all four problems: swipes and actions, plain bubbles, scrolling while streaming, and the keyboard and composer. They also want it smoother and more native: a Liquid Glass tab bar, haptics and real transitions. Xcode and a single device are available, so native work is fair game.

Success: an RP session feels like a polished native visual-novel reader. Nothing jumps, actions are one gesture away, and lore is easy to switch on.

## Goals

1. **Stage + Novel chat layout** (mockups `rp-layout.html` C + A, merged in `rp-stage-novel.html`):
   - **Top of a chat:** a large character portrait (`avatar_path`) with a soft accent-coloured radial glow, the name in serif, and the scenario on one line.
   - **On scroll:** the portrait collapses into a compact header with a small glowing avatar, the name, a Tune chip and a Lore chip. The header shows "writing…" while a reply streams.
   - **No avatar:** the character's initial on the accent→cyan gradient.
   - **Assistant messages:** a small avatar plus an uppercase name tag above serif prose (Georgia stack, ~14.5px, line-height ~1.6), with a 2px accent rule on the left. `*actions*` are muted italics; dialogue is full-brightness fg.
   - **User messages:** small tinted bubbles (`accent/15`) on the right.
   - Must use the theme tokens so the amber and green themes still work.
   - **Text mode (💬, owner decision):** keeps chat bubbles, restyled to match the glass/tokens (assistant bubbles in `surface-2`, user bubbles accent). Its staged burst reveal and "typing…" stay as they are. A swipe or the version dots act on the whole burst set (the existing `burstSwipe` on `burstHead`), not on a single bubble. The stage header (portrait, then compact header) applies to both modes.
   - **Other header controls (my call):** the compact header gets a `⋯` overflow menu holding the persona picker ("as …"), the 💬/🎭 mode switch and Card (edit). Nothing is dropped.
2. **Streaming / scroll:**
   - Auto-follow the bottom while a reply streams, unless the user scrolls up. Scrolling up stops following and shows a glass "↓ Latest" pill. Tapping the pill, or scrolling back to the bottom, resumes following.
   - Keep the existing streaming caret.
   - No Stop button (owner: replies always finish). Send is disabled while generating.
3. **Versions & actions:**
   - Remove the always-visible action row.
   - Version dots plus "n / m" sit under the assistant reply.
   - **Swipe (touch):** horizontal swipe on the latest assistant reply changes version, with a haptic. Swiping right past the last version regenerates a new one, as in SillyTavern.
   - **Long-press menu:** a glass menu with Edit, Regenerate, Wild, Rewind here, 👍/👎, Thought and Copy.
   - The 📌 Memory `<details>` moves into the Tune sheet.
   - **Mac / browser (no touch):** the same actions appear as a hover toolbar. The version arrows stay clickable.
4. **Composer:**
   - A floating glass textarea that grows to about 5 lines, then scrolls internally, with a round icon send button.
   - It stays pinned above the keyboard with no jump; the WKWebView already shrinks with `keyboardLayoutGuide`.
   - The bottom tab bar is hidden in chats.
5. **Lore access (owner request):**
   - A 📖 chip in the chat header shows the number of lorebooks attached (0–2: character book + chat book; my call) and opens a glass sheet. The sheet has:
     - the character's linked book, read-only and labelled;
     - this chat's lorebook, chosen from the library;
     - an Import button: a file picker for .json World Info or character cards with an embedded book. It reuses `POST /api/rp/lore` multipart, then selects the new book for this chat.
   - **Share sheet (iOS):** "Share → NAI Studio" on a .json file imports it into the library. This needs:
     - the share extension (`ios/Share`) to accept `public.json` in addition to images;
     - `Inbox` to drop it in a separate `lore/` subfolder, so it never replaces a waiting image or goes to the Tagger (my call);
     - the app to forward it to `/api/rp/lore`.
6. **Haptics bridge:**
   - The web page posts `{haptic: "light"|"medium"|"success"|"error"|"selection"}` over the existing `studio` message handler; Swift plays it with `UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator`. It is a no-op outside the app.
   - Used on: send, reply finished, version swipe, long-press menu open, lore toggled, image done, errors.
   - Also: no tap highlight, no rubber-band scrolling on fixed screens.
7. **Native glass tab bar:**
   - A real `UITabBar` with Liquid Glass (iOS 26+ appearance) at the bottom of the native shell. Tabs come from `src/lib/tabs.ts` (studio, comfy, roll, closet, chat, rp). Selecting a tab calls the existing `sendIntent(["tab": …])` path.
   - The web page tells Swift when to hide the bar with `{tabbar: {hidden: bool, tab}}`: hidden inside an open RP chat or Chat thread, and while the keyboard is up, like Messages.
   - The web LiquidIsland nav stays for Mac and browsers. In the app the island is hidden.
8. **Smooth transitions:**
   - The CSS View Transitions API for tab switches and list → chat, with a shared-element zoom from a character thumbnail to the stage portrait.
   - `content-visibility: auto` on long message lists for 120 Hz scrolling.

## Non-goals

- No new chat features: model behaviour, prompts and lore matching are unchanged.
- No expression sprites or animated portraits on the stage. It is a static avatar for now; the existing mascot stage rig is a separate thing.
- No multi-lorebook stacking per chat; the current model stays (character book + one chat book). (my call — avoids a schema change; revisit if wanted)
- No "lore entries used" indicator under replies. (my call — useful for debugging semantic activation, but it is extra API plumbing; add later)
- No SwiftUI rewrite. The UIKit lifecycle stays, because SwiftUI hosting crashed on iOS 27.2 beta.

## Anti-goals (fail even if it "works")

- Text jumping or the view yanking down while you're reading scrolled-up history.
- The keyboard covering the composer, or the composer bouncing when the keyboard opens.
- Swiping that fights vertical scrolling. The swipe must lock to horizontal only after a clear horizontal intent.
- Breaking the amber and green themes, or the Mac/browser layout.
- Losing any existing action: rate, thought, rewind, edit, wild.

## Constraints

- Web: Next.js studio in `studio/`. Never run `next build` in the live dir; deploy only with `npm run deploy` after explicit approval.
- iOS: `ios/NAIStudio.xcodeproj` (project.yml). Builds go through the xcode-runner subagent. Keep the UIKit lifecycle. The bridge stays same-origin-checked like the existing `theme` and `activity` messages.
- Ponytail: minimal diffs, reuse existing components, and no new npm dependencies (CSS and native APIs only).
- The existing lore API (`/api/rp/lore`, `TuneSheet` chat lorebook patch `{op:"chat", lorebookId}`) is reused, not replaced.

## Suggested order

1. RP chat layout + streaming + composer + actions (web only, biggest win).
2. Lore sheet + import.
3. Haptics bridge.
4. Native tab bar.
5. Transitions.
6. Share-sheet JSON import.

Each step ships on its own.

## Left to the builder

- Exact collapse animation curve and thresholds for the stage portrait (scroll-linked; CSS scroll-driven animation if supported in WKWebView, otherwise a small scroll listener).
- Swipe implementation: pointer events, with an angle threshold.
- Long-press duration (~400 ms) and menu positioning.
- The glass recipe in CSS (backdrop-filter blur plus a translucent border, matching the mockups).
- How the native tab bar and the web layout coordinate safe-area insets.
