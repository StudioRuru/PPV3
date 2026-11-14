# RP: character fidelity, profiles, Text/RP modes, in-character thinking

Date: 2026-11-14 · Studio (`studio/`, live on :3100) · Status: draft for owner review

## Why

The owner's complaint, in their words: characters "did not adhere closely enough to said character. Each retry or new
conversation between characters felt the same. Where other platforms felt like each character imported card had their own
personality and individualness."

A trace of the two cards in the DB found these causes. The owner confirmed they match.

1. **Wrong name and identity.** The full card title ("Alice, the bimbo paizuri elf (Fixed and Extended)") is used as
   `{{char}}` everywhere. The multi-character card "Abyssgard Sisters" (Fuwawa & Mococo) is treated as one person.
2. **Global sliders override the card.** The global agency "Willful" fights a gullible, easily led Alice.
3. **Generic steering.** `steerTurn` (`src/lib/rp/turn.ts`) draws from the same DIRECTIONS, OPENINGS and VOICE pools
   for every character, so every character gets the same nudges. This is the main source of sameness.
4. **The card's voice is lost.**
   - Multi-speaker example dialogue fails `parseExampleDialogue` and becomes an unstructured blob.
   - The voice reminder is empty when `personality` is empty (Abyssgard keeps everything in `description`).
   - Card-specific formats (Abyssgard's `Fuwawa's Thoughts: **…**`) are never reinforced.
5. **Flat traits and long replies.** Alice keeps repeating the same 2–3 surface traits, and replies run about 3× the
   length cap.

Success means two different cards feel like two different people. Retries differ in content but stay in voice. A card's
own quirks (formats, verbal tics, relationships) show up without prompting.

## Goals

- **G1 Character fidelity:** fix causes 1–4 in prompt assembly.
- **G2 Character profile:** a compact profile, extracted once per card, that the owner can edit. It is injected every
  turn and grows during long chats.
- **G3 Two chat modes:** 💬 Text and 🎭 RP, switched by a pill at the top of the chat. They replace today's
  Auto/Texting/Story style.
- **G4 In-character thinking:** a hidden "think as the character" step before each reply. It ships always-on if, and
  only if, the bench shows it improves quality.

## Non-goals

- New models. APEX (`gemma4-26b-apex`) stays the default. Behemoth stays an off-by-default pod option: it shows in the
  picker only while the pod tunnel is up, and nothing changes there.
- Group chats with several separate character cards. Multi-character *cards* are in scope; multi-card chats are not.
- Memory retrieval/RAG, sampler work (DRY/XTC), anti-slop retry, Impersonate/Continue. These are backlog.
- Push notifications for double-texts.

## Anti-goals (fails even if it "works")

- Every character still sounds like APEX's house voice.
- The thinking step leaks into the visible reply, or makes the reply generic: "Thinking in Character" (arXiv 2506.01748)
  found that generic reasoning causes style drift.
- Text mode turns into narration with line breaks, or RP mode turns into texting.
- The profile overrides what the owner wrote on the card. The card text is the source of truth.
- A regression on the RP bench (`scripts/rp-bench.mts`) for APEX: judge score below 8.7, or lengthOk below 0.95.

## Constraints

- Local hardware: M4 Pro, 24 GB. Ollama serves APEX at about 5 s per reply. Budget for the thinking step is 2× latency
  (10–12 s).
- When Ollama gets an explicit model, `think: false` must stay set (`src/lib/llm.ts`). Otherwise APEX's native thinking
  uses up the whole reply budget. G4 is our own explicit pass, not Ollama's `think`.
- `foldSystem` (aaba092) must stay the last step of `buildTurn`. Anything new that adds system notes gets folded.
- Deploy only through `npm run deploy`. Tests: `npx tsx --test src/lib/rp/*.test.ts`. Typecheck:
  `npx tsc --noEmit -p .`.
- Photos use the existing NovelAI client (`src/lib/novelai.ts` `generateImage`) and the `rp_images` table. Today that
  table only holds images migrated from Delfino.

## What the owner decided

- The fix is "profiles about the character", and character fidelity is fixed **first**, before the modes.
- **🎭 RP mode:** "the character interacts with user, self narrating and playing along user which at times user may
  'act' out actions and they respond descriptly." The user's `*actions*` get vivid, descriptive reactions.
- **💬 Text mode:** "Option B — burst + extras." Like texting on Aspect or iMessage:
  - a reply arrives as 2–5 short bubbles, each with its own typing indicator;
  - the character can react to the user's message with an emoji;
  - she sends photo messages, both on her own and when asked ("both, she can send on her own or when I ask");
  - she sends a follow-up double-text if the user goes quiet.
- **Switch:** a pill at the top of the chat (💬 Text | 🎭 RP), switchable mid-chat.
- **Thinking:** "if it increases the quality, always have it run."
- **Text-mode retry keeps old versions:** each retry is saved, and ‹ 1/3 › flips between whole bursts, like today's
  swipes.
- **Ensemble cards in Text mode look like a group chat:** each bubble shows who sent it.
- **In RP mode the card's POV wins:** third person applies only when the card doesn't set one.

## Design

### 1. Character fidelity (prompt assembly: `prompt.ts`, `turn.ts`)

- **Display name.** Add `RpCharacter.displayName`, filled at import from the profile extraction (§2) and editable on the
  character sheet. `{{char}}`, the "You are {name}" block and steer notes all use it. The card title stays as the list
  label only.
- **Ensemble cards.** The profile extraction finds the cast: `cast: [{name, role}]` with more than one entry means an
  ensemble.
  - The system block says: "You play {A} and {B}. Speak for each by name; keep their voices distinct."
  - Multi-speaker example dialogue is split into turns per speaker, so `Fuwawa:` and `Mococo:` lines both count as the
    character. It is no longer an unstructured blob.
  - Recurring formats from the card's greeting and examples (e.g. `X's Thoughts: **…**`) go into the profile's `format`
    field and are restated in the post-history voice reminder.
- **The card beats the sliders.** Each setting resolves in this order:
  per-chat Tune > hand-set character field (e.g. `RpCharacter.agency`) > `profile.defaults` > global setting.
  - **Agency:** `profile.defaults.agency` replaces the global value. Nothing is blended.
  - **Spice:** the profile may give a `{min, max}`, and the global spice is clamped into that range.
  - **Mods:** stay under the owner's control. When the profile is built, it lists any enabled global mods that
    contradict the card in `profile.conflicts` (shown on the sheet, e.g. "Willful agency vs. gullible"). Nothing is
    switched off automatically.
- **Voice reminder fallback.** When `personality` is empty, the reminder uses the profile's core traits and speech
  lines instead of nothing.
- **Character-specific variety.** `steerTurn` keeps the fresh seed, the "don't reuse openings" rule, the regenerate
  drafts and the hotter sampler. The generic DIRECTIONS pool gives way to directions drawn from this character's
  profile: its wants, fears, tics, relationships and hooks, e.g. "let Alice's habit of chasing pretty things derail
  her." Generic adult/wild pools stay as a minority fallback.
- **Trait rotation.** The per-turn profile slice (§2) rotates which traits and hooks it emphasises, so Alice doesn't
  hit the same three traits every reply.

### 2. Character profile

When a card is imported, and on demand with "Rebuild profile" on the character sheet, APEX reads the card text and the
avatar once (vision, like the existing "read characters" flow) and writes JSON stored on the character
(`RpCharacter.profile`):

```
displayName, cast[{name, role}], coreTraits[], speech{register, tics[], sampleLines[]}, format,
wants[], fears[], knows[], doesntKnow[], viewOfUser, wouldNever[], hooks[], relationships[],
defaults{agency?, spice?, mode?}, appearanceTags (NovelAI), learned[] (appended during chats)
```

- **Editable.** The character sheet gets a Profile section: plain fields, one item per line. Owner edits are kept.
  Rebuilding the profile asks before it overwrites.
- **Injection.** Each turn adds a short slice of about 150–250 tokens, placed with the post-history voice reminder:
  - always: name/cast, format, `wouldNever`, speech register plus 1–2 tics;
  - rotating: 2 core traits, 1 want or fear, 1 hook;
  - in Text mode, speech lines are favoured; in RP mode, body language and hooks are favoured.
- **Growth.** When `shouldSummarize` runs (`memory.ts`), the same pass also pulls out up to 3 new durable facts about
  the character from this chat (things she said she likes, promises, nicknames). They are added to the **chat's**
  memory as `learned` facts, not to the card-wide profile. Chats stay separate, and the card's profile stays clean.
  Card-wide edits are manual.
- `appearanceTags` come from the card's text plus the avatar. If the character already has `appearancePrompt` or
  `outfitPrompt`, those take priority.

### 3. Modes: 💬 Text and 🎭 RP

`RpChat.style` changes from `"" | "chat" | "story"` to `"text" | "rp"`. Migration: `chat` → `text`; `story` and `""`
→ `rp`. A new chat takes its mode from `profile.defaults.mode`, falling back to `rp`. The pill sits in the chat header,
next to the name/avatar, as in the mockup. Switching mid-chat keeps the same thread; the next reply follows the new
mode. The Tune sheet's Style picker is removed.

**🎭 RP**
- The card's `povMode`, `tense` and `dialogueStyle` win when they're set. The RP directive replaces only the missing
  ones, defaulting to third person / past tense. This replaces today's "a chat style replaces the card's POV locks"
  behaviour (prompt.ts ~391).
- Dialogue appears inline. When the user writes `*action*`, the reply reacts physically and descriptively before
  speaking.
- The user's `*actions*` render in the existing italic action style.
- Length follows the reply-length slider as today. Fixing the 3× overshoot is backlog, but the thinking step's length
  plan (§4) should help.

**💬 Text (option B)**
- **Generation.** One model call per reply. The model writes 2–5 short texts separated by a delimiter line (`---`).
  There is no narration and no `*actions*`. The server splits on the delimiter. Each bubble is saved as its own
  assistant message sharing a `burstId`, so history, regenerate and swipes work per burst.
  - **Retry (owner decision):** keeps old bursts reachable.
    - A burst-level swipe store: the burst's head message holds `burstSwipes`, each a list of bubbles with their
      reaction and photo links. ‹ n/m › on the burst's last bubble flips the whole set.
    - Bubble counts can differ between versions. The reaction and photos belong to the version.
    - Only the last burst can be regenerated, as today with the last reply.
  - Fallback: if the model ignores the delimiter, split on blank lines, then on sentences, up to 5.
- **Delivery.** Bubbles stream to the UI one by one. Before each one, a "typing…" indicator shows for about 40 ms per
  character, clamped to 0.6–3 s. "Typing…" also shows under the name in the header.
- **Reactions.** The model may start a burst with `[react:😭]`. That emoji attaches to the user's last message (stored
  on that message, `reaction`) and is not shown as text.
- **Photos.**
  - The model may emit `[photo: short description]` as a bubble, either unprompted (rarely: steered at most about one
    per 8 turns) or when the user asks for a pic.
  - The server turns it into a NovelAI prompt: profile `appearanceTags` + outfit + the description mapped to tags.
    `generateImage` renders it, and the result is stored in `rp_images` and linked to the message.
  - The bubble shows a placeholder while it renders, then the image. Tapping opens the image full-screen.
  - Spice gates how explicit the photo can be. The same content rules as the chat apply.
- **Double-text.** If the last message is hers and the user is silent for a random 2–6 minutes *while the chat is
  open*, she sends one follow-up burst of 1–2 bubbles, e.g. "helloooo?? 🥺".
  - At most one in a row.
  - Off with one tap: a toggle in the chat's ⋯ menu, on by default.
  - It needs no server cron. The open page sets the timer and calls a `nudge` endpoint, which runs a normal turn with a
    "the user hasn't replied in N minutes" note.
- **Ensemble cards (owner decision): group-chat look.** Each bubble is written `Name: text`. The parser sets a
  `speaker` on each bubble, and the UI shows the name plus a small avatar or colour dot per speaker.
  - A photo uses the speaker's `appearanceTags`. The profile keeps tags per cast member.
- **Voice.** Casual and in the character's speech register from the profile: emoji, lowercase and typos only if they
  fit her. "Texting" means the medium, not one shared personality.

### 4. In-character thinking

Before the reply call, a hidden planning call to the same model (APEX, `think: false`, about 200 tokens, lower
temperature) is asked **as the character**, in first person:

> "You are {name}. Privately, in 3–5 short lines: what you feel about what {user} just did/said; what you want right
> now; what you'll do or say (one concrete, specific-to-you choice); which of your quirks shows; in Text mode, how many
> texts you'll send."

The plan is passed to the reply call as a folded note: "[Your private intent — act on it, don't repeat it]". It is
never shown. It is stored on the message (`thought`) for debugging, viewable from the long-press menu.

- This follows the role-aware ("Role Thinking") approach of HER-32B and Character-R1, not generic chain-of-thought.
  That matters because generic reasoning causes style drift.
- **Gate.** Add a `--think` flag to `rp-bench.mts`. Run the APEX baseline against APEX+think on the existing 3
  scenarios (2 runs each), with the same judge.
  - Ship always-on if judge ≥ baseline + 0.2 with no drop in lengthOk/memory.
  - If the gain is smaller, ship it as a per-chat toggle that defaults to off, and report the numbers to the owner.
- **Re-check after Text mode.** The gate runs once on today's formats (step 2). It runs again after Text bursts land
  (step 3), with the bench's Text case moved to `style: "text"` and burst-aware length scoring.
  - The Text case is rebaselined.
  - The anti-goal bars (judge 8.7, lengthOk 0.95) apply to the RP cases.
  - If thinking loses in Text mode, it is turned on per mode.
- **Latency.** The typing indicator covers the plan call in Text mode. In RP mode the reply streams after the plan.
- **HER-32B as an option.** Test `ChengyuDu0123/HER-32B` (Qwen3-32B, role thinking built in) as a local model through
  the same bench, as a Q4 GGUF if it fits in 24 GB alongside the rest, otherwise as a pod model.
  - This is an evaluation only. It gets added to the picker if it beats APEX+think.
  - It must not block the rest of this design.

## Order of work

1. Fidelity fixes plus profile extraction and injection (§1–2). Re-bench, and A/B the two real cards by hand.
2. Thinking step plus its bench gate (§4).
3. Modes: pill, RP mode cleanup, Text bursts/typing/reactions (§3).
4. Photos and double-text (§3 extras).
5. HER-32B evaluation (optional, can run in parallel).

## Left to the builder

- Exact prompt wording, slice rotation and tag mapping for photos.
- The DB schema: columns vs. JSON for `profile`, `burstId`, `reaction`, `thought`, and the photo link. Follow the
  existing `schema.ts` migration style.
- How bubbles stream to the client (extend the current send route's stream).
- Bench additions: a two-card "distinctness" check is welcome. One idea: the judge sees replies from both cards to the
  same user line and rates how different they are.

## Calls I made (owner, please check)

- `displayName` and the cast come from APEX extraction and are editable, rather than parsed from the title with a regex.
- The precedence order is per-chat Tune > hand-set character field > profile defaults > global. Spice is clamped
  into the profile's range. Conflicting mods are flagged, never switched off.
- The thinking gate re-runs after Text mode. The Text bench case is rebaselined. Thinking can be on per mode.
- Learned facts go to the chat's memory, not the card-wide profile.
- New chats default to RP mode unless the profile says otherwise. Old "Texting" chats become Text.
- Typing delay is about 40 ms per character, clamped to 0.6–3 s. Spontaneous photos happen at most about 1 in 8 turns.
  Double-text happens after 2–6 minutes, only while the chat is open, at most once in a row, and is on by default with
  a toggle.
- The thinking ship bar is judge +0.2 with no regressions. Otherwise it becomes a toggle that defaults to off.
- Photo appearance comes from the card text + avatar. An existing `appearancePrompt` wins.
