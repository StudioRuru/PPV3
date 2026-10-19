# Miyabi: Just Chat — Design

## Intent

The owner wants a companion space with Miyabi: one-on-one talk like texting a familiar friend, with no prompt
assistance. The point is a relationship that builds over time — she remembers, she changes as they get closer,
and the conversation can wander off and come back. "A way to make her more real and with better memory."

Today Miyabi's threads are a prompt co-pilot (patch cards, studio talk) and every thread starts blank.

## Goals

- A **Just Chat** mode in the existing Chat tab: Miyabi as companion, on the APEX (heavy tier) model.
- **No prompt help** in this mode: no patch cards, no co-pilot instructions, no studio talk unless the owner
  raises it. Her expression tag stays (it drives her portrait), but it is the only bookkeeping.
- **Memory she keeps herself**: facts about the owner, their life, in-jokes, shared moments. Written by her as
  they talk, read before every reply, so conversations pick up where they left off.
- **She changes too**: alongside the facts she keeps her own sense of where the two of them stand. Her warmth,
  openness and tone shift as they get closer, visibly over weeks.
- **Peek and correct**: the owner can open her notebook, fix a wrong entry, or delete one. Otherwise she decides
  what goes in.
- **Slime + closeness**: the active slime still sets her base personality and Aru's potions/sliders still work.
  The relationship layers on top and carries across slimes.
- **Switch**: at any point, branch off into a side conversation, then jump back to the main thread where it was.
- **Save points**: rewind to an earlier moment and replay it differently, like a game save.
- **One memory across all branches**: a rewound timeline or side conversation still happened to her and she can
  bring it up later.

## Non-goals

- Changing the existing co-pilot Miyabi threads or Aru's threads. They stay as they are.
- Voice, images, or a new tab.
- A visible points/affection meter (see calls below).

## Anti-goals (a failure even if it works)

- She slips back into prompt-assistant mode (patch cards, tag suggestions) in Just Chat.
- Replies get noticeably slower because of memory work.
- Memory feels like a database readout ("According to my records…") instead of a friend who remembers.
- She forgets something important the owner told her, or "remembers" things that never happened, with no way
  for the owner to fix it.

## Constraints

- Studio stack: Next.js app in `studio/`, SQLite via better-sqlite3, Ollama models through the existing tier
  system (`src/lib/tiers.ts`; heavy = APEX `gemma4-26b-apex`, gated by `HeavyGate` on the 24 GB Mac).
- Miyabi threads already run on the heavy tier (`modelFor` in `src/lib/chat-model.ts`), and her persona comes
  from the active slime (`chatPersona` / `slimePersona`). Reuse both.
- Threads are stored by `ThreadStore` (`src/lib/threads.ts`); the client's message list is the truth for a
  thread (edits and regenerate rewrite history).
- The RP tab already has a detached rolling-summary memory (`src/lib/rp/memory.ts`, `foldPlan`) — prior art to
  borrow from.
- Phone-first (the iOS WKWebView app). Everything must work one-handed on the phone.
- The empty-slime behaviour ("Data received.") still applies when no slime is active.

## Decided by the owner

- Lives in the Chat tab as a mode, on APEX, companion only.
- Save points rewind and replay; she remembers abandoned timelines.
- Memory: she writes it, the owner can peek, correct and delete.
- She changes over time, not just knows more.
- Active slime + potions still shape her; closeness carries across slimes.
- Closeness wins over the slime: the slime sets her base personality, but the relationship overrides it around
  the owner. Even a cold, standoffish slime softens with them once they are close. In the prompt, the relationship
  layer comes after the slime persona and takes precedence.

## My calls (owner can override)

- Memory updates run quietly in the background after each exchange (detached, like RP memory), so replies are
  never waiting on it.
- "Where we stand" is prose she writes about the relationship, not a number or meter the owner sees. It is part
  of the notebook, so the owner can read and correct it too.
- One relationship (one notebook) for Miyabi in Just Chat, shared across all Just Chat conversations and branches.
- Branches are conversations linked to the conversation and message they came from, so "back to main" and
  "rewind to here" are both "open/start a branch at a message".
- Notebook writing uses the same heavy model right after her reply, while it is still loaded.
- Abandoned timelines (owner's answer): she knows they happened, like déjà vu, even while replaying the same
  moment, and can bring them up. Notebook entries record which branch and message they came from, so the prompt
  can frame them as "in another version of this conversation".
- Only settled exchanges are written to memory: an exchange is folded once the owner has moved on from it (sent
  the next message, branched, or rewound). A reply that was regenerated or edited away never reaches the
  notebook. Rewound-away exchanges were settled, so they do.
- Owner edits win: an entry the owner fixed is pinned (her later passes may not rewrite it), and an entry the
  owner deleted leaves a tombstone so she doesn't re-learn it from old transcripts.
- Replies always come first: a notebook write never delays a reply. If the owner sends a message while a write
  is running, the write yields and resumes later from where it stopped (high-water mark, like RP memory), so
  nothing is skipped, only delayed.
- Just Chat always starts fresh. Existing co-pilot and Aru threads neither convert nor feed the notebook.
- A side conversation ("switch") is a branch at the current message: she sees the conversation up to that
  point plus the notebook. "Back to main" returns to the main thread where it was. A save point uses the same
  branching from an earlier message.

## Left to the builder

- Storage shape for the notebook, branches and save points.
- How the notebook is kept bounded (merging, pruning, summarising) as it grows over months.
- How memory is selected into the prompt within the context budget.
- The exact UI for entering the mode, branching, returning, rewinding and the notebook sheet, following the
  existing Night Studio look and Chat tab patterns.
- Prompt wording for companion mode and for notebook updates.
