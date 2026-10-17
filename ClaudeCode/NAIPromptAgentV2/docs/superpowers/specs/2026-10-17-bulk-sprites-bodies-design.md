# Bulk sprites, bodies & island progress — Design

> **PARKED 2026-10-17 by the owner — resume after the ComfyUI build.** Two open questions for the owner when it resumes: (1) do the ~260 existing sprites (made with the old `bust shot` tags) count as stale on the first "Start all" (redo all ≈ 1 h free) or only missing cells; (2) should a slime made from an RP card also create a body (and offer to wear it on insert), or bring personality only. Not approved yet.

> Sub-project B. Brainstormed in chat 2026-10-16/17. Comes after Plan 22 (animation layers 1+2, shipped) and before the ComfyUI build (layer 3, which also replaces the warp "wobble" and the blink pop the owner dislikes; no animation changes here).

## Intent
Making a character's full sprite set is the biggest job in the app: hundreds of images, each needing a pick. Today it's done cell by cell in the foreground. The owner wants to **tap once, walk away, and come back to a grid to approve**. The phone's Dynamic Island shows progress while the app is closed. The owner also wants fewer images to reject in the first place.

The owner also wants **body and personality separated**. Today a slime holds both her look and her mind. From now on:
- a **body** is the look tags plus the sprites made from them;
- a **personality** (the slime) is how she acts and speaks: voice, sliders, memories, vials, demeanor, mental logic.

New bodies live on their own shelf and can be chosen like other mascots. Bulk images belong to a body.

## Goals
1. **"Start all, walk away."** One tap queues every missing (or stale) sprite cell for the chosen character. The Mac does the work in the background. The owner can use other tabs or lock the phone.
2. **Island progress while the app is closed.** The island shows a countdown shown as a percentage ("Bulk can run as a countdown but inferred as a percentage"). It's driven by APNs push from the Mac, because the owner has a paid Apple developer account. It ends with a done mark and a notification.
3. **Review on return.** The owner sees a grid per section, taps the images to keep, and the rest are queued to regenerate in the background (positive selection).
4. **Fewer rejects.** The owner's reject causes are "bad framing or pose" and "anatomy or art glitches"; identity and outfit are fine. Fix the framing root causes found in recon (below).
5. **Bodies shelf.** Body and personality are separate. Removing a slime leaves the body and its sprites intact. Any personality can wear any body.

## Non-goals
- No bulk for clips (owner chose "Sprites only"). The Clips tab stays as is.
- No animation changes; those wait for ComfyUI.
- No changes to the negative tags for age reasons ("she's 100% adult"). No age wording anywhere.
- No mixing of bodies. Jar mixing keeps blending personalities only.
- No Stop button in the island (Stop is in the app). *My call: an island Stop would need the intent to reach the server while the app is suspended. Add it later if wanted.*

## Anti-goals (failure even if it "works")
- **Spending Anlas.** Bulk must never cost anything: free tier only (≤ 1 Mpx, ≤ 28 steps), checked per image.
- **Replacing a sprite the owner didn't keep.** Bulk writes candidates only. A sprite changes only when the owner taps Keep.
- **Breaking interactive use.** A running bulk job must not make normal Studio generation fail, and must not freeze the app.
- **Losing data in the body migration.** Every existing slime's look and sprite folder must survive.

## Constraints (standing)
- **Repo:** `studio/` (Next.js 16, better-sqlite3, node:test via tsx) and `ios/` (xcodegen, team `9TL96DXFPC`, app `com.philly95.naistudio`, widget `com.philly95.naistudio.widgets`, app group `group.com.philly95.naistudio`).
- **Server:** the Mac mini runs `next start` under launchd (`npm run deploy`). The phone reaches it over Tailscale.
- **Git and test hygiene:**
  - Commit named files only, with `git -c user.name="Philip Chan" -c user.email="rurudayo@mac.home"`.
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never push, `git add -A` or `git stash`.
  - No live NovelAI calls in tests.
  - Dev servers use a scratch copy of the DB; never write the real `data/`.
- **Secrets:**
  - Never print the NovelAI token.
  - The APNs `.p8` key lives **outside the repo**. Only its path, key id and team id go in `studio/.env`. Never log or commit the key.
- **iOS:**
  - Edit `ios/project.yml`, never the `.xcodeproj`.
  - Never run `ios/build.sh` or `devicectl` without the owner's yes.
  - The build check is the `xcodebuild … build` from Plan 21.

## Recon findings (2026-10-16, free test gens, compared over 6 random seeds per variant)
- **Two views in one image** is caused by `bust shot` in Miyabi's `charTags`: 6/6 seeds produced two views with it, 1/6 without it.
  - Tag order, `artist:asanagi` and extra two-view UC tags made no difference.
- **Second offender:** the sleepy expression's weighted `1.3::upper body::` plus arm actions (`shirt lift, scratching chest`). These explain 3 of the 4 sleepy A-pose failures.
- **Peek pose** fails often. A wall prop helped only slightly.
- **Anatomy** looked fine at sprite size. Background tints are removed by cutout anyway.
- With a fixed seed, the composition barely changes between prompt variants. Compare prompts across several random seeds instead.

## 1. Bodies (body / personality split)

### Model
- **Body** = `{ name, color, charTags, constantTags, layerTags{day,night,lewd}, exprTags{9}, spriteDir }`, stored in a new table (e.g. `mascot_bodies`, JSON doc per row like slimes).
  - Each body owns its sprite folder under `data/mascot/`.
- **Slime** (personality) = today's `SlimeDoc` minus `look`: name, colour, voice, selfName, sliders, heatDrift, memories, vials, origin.
- **Settings:**
  - New `bodyId`: the body currently worn.
  - `empty` keeps meaning "no slime inserted".
  - The live look fields used by `profileLook` now come from the worn body.
- **Combining them:** any slime can be inserted into any body.
  - Inserting a slime changes personality only.
  - Wearing a body changes look only.
- **Removing the slime** leaves the body standing, dimmed and "empty" as today, with its sprites untouched.

### Migration (runs once at startup, idempotent)
- Copy `studio.db` to `studio.db.pre-bodies` before the first migration. *(My call.)*
- Each slime's `look` becomes a body. Identical looks (same `spriteDir` and same tags) collapse into one body.
  - Body names take the slime's name ("Miyabi's body"); the owner can rename them.
- The current live look becomes the worn body.
- Slime docs keep their old `look` field for one release as read-only legacy (so a rollback still works), but nothing reads it.
- **Aru stays a separate shop profile**, not a body on the shelf. *(My guess; the owner said "no issue".)*

### Bodies shelf UI
- A second shelf beside the slime jars, with one card per body showing the body's smug bust (placeholder if none) and its name. Tap a card to wear it.
- **New body:** duplicate the current one, or start blank (empty tags).
  - Its tags are edited where the look tags are edited today (sprite studio / settings).
  - Delete is allowed only for a body that isn't worn. The sprite folder is moved to `data/mascot/.trash/`, never hard-deleted.
- The sprite studio works on the worn body by default, with a body picker at the top (plus Aru as today).

### Stale sprites
- Each saved sprite records a short hash of the request it came from: the look tags after framing cleanup (§4), the framing, and the size.
- When a body's tags change, sprites whose hash differs show as **stale**: a small badge in the studio grid, with the sprite still used until replaced.
- "Start all" counts missing **plus** stale cells. *My call:* stale cells stay in use until the owner keeps a replacement.

## 2. Bulk queue (server)
- **Scope of "Start all"** for the chosen character (a body, or Aru): every cell the studio grids show that is missing or stale.
  - Busts: outfits × expressions.
  - Poses: faced poses × outfits × expressions, plus back × outfits.
  - Talk portraits: outfits × talk frames.
  - Aru: day talk portraits only.
- **Start:** one confirm in the app showing the count, `0 Anlas`, and a time estimate. Paid settings are refused before queueing.
  - If a run is already going, new cells are appended to it. One run at a time. *(My call.)*
- **Storage:** run + items in SQLite. A run has id, character, status (`running | paused | done | stopped`), counts and timestamps. Each item has a key, status (`queued | running | ready | kept | failed`), attempts, last error and seed.
  - A server restart resumes a `running` run from its queued items.
- **Worker:** one in-process worker in the Next server, started on boot (e.g. `instrumentation.ts`) and on the first bulk API call.
  - It runs strictly sequentially, one image at a time, through the existing `generateImage` and request builders.
- **Output:** one candidate per cell per round (*my call: fastest pass; the owner rerolls the rest*). It's saved to the cell's existing candidate path (slot 0), so the existing `pick` (cutout, write sprite, clear clips) is reused unchanged when kept.
- **Spend guard:**
  - Each item checks `perImage(params) === 0` before calling NovelAI.
  - The run is wrapped in the existing `measured` cost check. Any non-zero cost **pauses the run immediately** and reports it.
- **Errors:** an item retries once. A second failure marks it `failed`, and the run continues.
  - 3 failures in a row, or a 401/402/403 from NovelAI, pause the run.
  - Resume and Stop are available in the app.
- **Interactive priority:** while an interactive generation (Studio/sprite studio/upscale) is in flight, the worker waits before starting its next image. Interactive requests never fail because of bulk; at worst they wait for the one image in progress. *(The builder picks the mechanism, e.g. a shared NovelAI lock in `novelai.ts`.)*
- **Progress estimate:** a moving average of seconds per image (seeded at 15 s) × remaining items gives `endsAt`.
  - Percentage = finished ÷ total, where finished counts both ready and failed items.

## 3. Island progress, push & done mark (iOS + server)
- **Live Activity content** gains an optional `job`: `{ label, done, total, endsAt }`.
  - Compact trailing shows the **percentage**, with a thin progress ring around her bust.
  - Expanded shows the label ("Miyabi · sprites"), a progress bar, "~12 min left", and the existing buttons.
  - The countdown between pushes animates by itself (`ProgressView(timerInterval:)` / `Text(timerInterval:)`). The percentage updates on each push.
  - With no job, the island is unchanged.
- **Push from the Mac:**
  - The app reports its Live Activity push token (`pushTokenUpdates`) and its push-to-start token (`Activity<…>.pushToStartTokenUpdates`, iOS 17.2+) to the server over the existing bridge. The page forwards them to a new authenticated `/api/push` endpoint, which stores them in the DB.
  - The server sends APNs over HTTP/2 with a token (ES256 JWT) using Node's built-in `http2` + `crypto`, with no new dependency.
  - Sends happen on run start, after each image but at most every 20 s (*my call, to stay under Apple's update budget*), on pause/stop, and at the end.
- **Push-to-start:** if no activity is alive when a run starts or finishes (it ended after 8 h, or was swiped away), the server push-to-starts one.
- **Done mark + notification:** at the end, the content shows a check mark and "Done · 214 ready, 6 failed". The final push includes an `alert`, so the phone shows a banner and lights the island.
  - The activity dismisses itself 1 h later. *(My call; it uses the Live Activity alert rather than a separate notification permission.)*
- **APNs environment:** sideloaded, development-signed builds use the sandbox host. The app gets the `aps-environment` entitlement (development) and `NSSupportsLiveActivitiesFrequentUpdates` if needed.
- **Fallbacks:** if APNs isn't configured (no key in `.env`), everything still works through the existing bridge while the app runs, and the server logs one line saying push is off. A push failure never affects the run.
- **Other heavy jobs on the island:** I checked; Aru's brewing is an instant DB insert, not a long job. The `job` slot is generic, but only bulk uses it for now. *(My call.)*

### APNs key walkthrough (for the owner; the controller guides it live)
1. In the developer portal: Certificates, IDs & Profiles → Keys → **+** → name "NAI Studio push" → tick **Apple Push Notifications service (APNs)** → Continue → Register → **Download** the `.p8` (only downloadable once). Note the **Key ID**.
2. Move it to `~/.config/naistudio/AuthKey_<KEYID>.p8` (outside the repo), then `chmod 600`.
3. Add `APNS_KEY_PATH`, `APNS_KEY_ID` and `APNS_TEAM_ID=9TL96DXFPC` to `studio/.env`.
4. Rebuild and install the iOS app (asks first). The App ID gains Push Notifications automatically through `-allowProvisioningUpdates`; if not, tick it under Identifiers.

## 4. Fewer rejects (prompt quality)
- **Framing cleanup:** sprite request builders (bust, pose, talk) strip framing tags from the look's char/constant/layer/expression tags before adding their own framing. Saved tags are never modified; the cleanup applies only when building the request.
  - Tags stripped include `bust shot, upper body, cowboy shot, close-up, portrait, full body, head and shoulders, face focus, lower body, wide shot`, in any weighted form (`1.3::upper body::`, `{upper body}`, `[…]`, `(…)`).
  - *(My call: the builder keeps the list in one place and tests it.)*
- **Settings flag:** where look tags are edited, any framing tag gets a small "ignored for sprites" chip, so the owner knows why it has no effect.
- **Expression actions in poses:** arm actions in expression tags (e.g. sleepy's `shirt lift, scratching chest`) stay as the owner wrote them. They were a smaller factor, and changing them would change her character. The weighted framing inside them is still stripped by the cleanup.
- **Peek redesign:** generate peek as a clean upper-body side lean (`upper body, leaning to the side, looking at viewer, hand on wall`, 1024×1024) and let the stage clip it at the screen edge. The stage already places peek at an edge.
  - The builder may tune the wording with ≤ 12 free test gens on a scratch copy, compared over random seeds.
- **No UC changes for anatomy.** Positive selection plus cheap free rerolls handles the occasional glitch. *(My call; revisit if the reject rate stays high.)*

## 5. Review grid (app)
- The sprite studio gains a **Review** view with a badge for the count of `ready` items. It's reachable from the bulk progress card, and the done notification opens it (`naistudio://tab/studio`, then review).
- **Sections:** Busts (by outfit), each Pose (by outfit), Talk. Each cell shows the new candidate next to the current sprite (if any) for comparison.
- **Tap** toggles Keep.
- **"Keep selected & redo the rest":**
  - Kept cells go through the existing `pick` (cutout, sprite, clear clips, stale cleared) and are marked `kept`.
  - Unkept cells are re-queued with a fresh seed, appended to the current run or starting a new one, with the same confirm rule (`0 Anlas`, count).
- `failed` cells appear greyed with a retry tap.
- Review state lives on the server, so it survives app restarts and works from any device.

## 6. Testing
- **TDD (pure / node:test):**
  - framing-tag stripping (plain, weighted, bracketed, mixed case);
  - stale hash (changes when tags change, not when unrelated settings change);
  - cell enumeration per character (counts; Aru day-only);
  - run/item state machine (retry once, pause on 3 in a row, pause on cost, resume after restart, append to a running run);
  - ETA / percentage;
  - migration (looks become bodies, dedupe, idempotent, the backup is made, legacy look is kept);
  - APNs payload builder (content-state shape, alert only at the end, dismissal date) and JWT header/claims (no network);
  - throttle (≤ 1 per 20 s plus forced sends).
- **No live NovelAI or APNs calls in tests.** Fake fetch and a fake http2 sender.
- **Controller live check (scratch DB copy):**
  - a small bulk run (e.g. one outfit's busts) on the free tier;
  - interactive generation during the run;
  - Stop / Resume, and a server restart mid-run resuming;
  - the review grid keep/redo;
  - wearing a body vs inserting a slime;
  - with the owner's yes, a device install for push: island percentage while locked, then the done banner.

## Left to the builder
Table and endpoint names, the lock mechanism for interactive priority, exact island layout within the existing widget style (Night Studio accent `#b7a4ff`), how the bodies shelf sits next to the slime shelf in the existing sheet, and the hash input format.

## Out of scope / later
ComfyUI layer 3 (video clips; replaces the warp wobble and blink pop), bulk clips, Stop from the island, body mixing, UC tuning for anatomy.
