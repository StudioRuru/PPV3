# Chat 2.0 — Plan 14 (sub-project 5 of 6)

> Executed inline. Approved in chat 2026-10-14: hybrid vision (ToriiGate eyes + Gemma reasons/follow-ups); learning = applied changes + per-persona drift + pinned preferences + like/dislike with a feedback question + attitude modifiers (bratty / tease / flirt); personas Bratty muse, Scene writer, Tag nerd (+ Neutral default). Design canvas board 6.

**Goal:** Chat becomes a full tab with conversation threads, image attachments the co-pilot can focus on, loadable personalities that learn the owner's taste, edit/regenerate/like/dislike, clearer tag application (natural-language tags marked as allowed; per-change include toggles), and a row of Closet presets to work from.

## Global constraints
- Threads: `chat_threads` (title, persona, modifiers, timestamps) + `chat_messages.thread_id`/`image`; existing history migrates into a "General" thread. The client's message list is the source of truth for a thread (edits/regenerate rewrite it); the server stores the full list after each complete reply.
- Image focus: attach → saved ≤1 Mpx JPEG in `data/chat-images/` → tagger tags + a ToriiGate caption steered by the user's focus question → injected as context for Gemma. Follow-ups in the same thread also hand Gemma the latest image directly (its own vision) for questions about it.
- Personas: Neutral, Bratty muse, Scene writer, Tag nerd. Modifiers bratty / tease / flirt (toggles). Drift 0–100 per persona: +2 per like/apply, −4 per dislike, manual slider; described to the brain as an intensity level.
- Taste: events (apply / like / dislike + note) → profile of favoured and avoided tags (top N) + pinned rules + last feedback notes, all in the system prompt. Viewable and resettable in Settings.
- Natural-language tags are shown as "NL" info chips ("V5 reads it; not a Danbooru tag"), never as warnings; each change in a card can be switched off before Apply.
- Brain stays Gemma 4 12B (no new downloads).

## Review focus
1. Migration of existing chat history; deleting a thread deletes its images.
2. Edit/regenerate never duplicates or loses messages in storage.
3. Attachment: non-image / HEIC / huge files → readable error; ToriiGate offline → the chat still works (tags + Gemma vision only).
4. Drift and taste can't push the prompt past a sane size (caps), and reset clears them.
5. Prompt-injection from library/image captions is contained (data, not instructions) — local, low risk, but captions are quoted as data.

## Tasks
1. `lib/persona.ts` (personas, modifiers, drift text, nextDrift) + tests.
2. `lib/taste.ts` (profile from events, prompt block, caps) + tests; tables + `/api/taste`.
3. Threads tables/migration + `/api/chat/threads` + chat route (thread, persona, taste, images) + tests for history rewrite.
4. `/api/chat/attach` (save, tag, focused ToriiGate caption) + focus query builder test.
5. Chat screen (tabs, persona sheet, messages with edit/regenerate/like/dislike + feedback question, attach, mode + preset rows) and PatchCard (include toggles, NL chips); Settings taste section; Chat tab wiring.
6. Verify, review, deploy.
