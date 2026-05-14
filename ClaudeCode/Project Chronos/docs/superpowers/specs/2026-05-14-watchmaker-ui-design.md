# Watchmaker UI — Design Spec
**Date:** 2026-05-14
**Status:** Approved

---

## Purpose

A local web interface for the Project Chronos watchmaker assistant. Allows the user to chat with Claude about watch movement repair and servicing, upload photos of movements and parts for visual analysis, and attach service manual PDFs as live context for the conversation.

---

## Constraints

- Runs locally only (`npm run dev`, localhost)
- Single user, no authentication
- No database or session persistence — each browser refresh starts a fresh conversation
- API key stored in `.env.local`, never exposed to the browser
- Service manual PDFs stored in `Project Chronos/Service Manuals/`

---

## Architecture

Next.js app at the root of `Project Chronos/`. Co-located with the existing `Service Manuals/` and `.claude/` directories.

```
Project Chronos/
  src/
    app/
      page.tsx              ← main chat UI (client component)
      api/
        chat/route.ts       ← streams Anthropic responses (server)
        manuals/route.ts    ← lists and reads PDFs from Service Manuals/
    components/
      ChatWindow.tsx        ← scrollable message list
      MessageBubble.tsx     ← single message (user or AI)
      InputBar.tsx          ← textarea + image attach + send
      ManualSelector.tsx    ← dropdown of available PDFs + active badge
  Service Manuals/          ← user drops PDFs here
  .claude/skills/watch/     ← existing watchmaker skill
  .env.local                ← ANTHROPIC_API_KEY=...
  package.json
  next.config.ts
```

### API Routes

**`POST /api/chat`**
- Receives: `{ messages, image?, manual? }` where `image` and `manual` are base64 strings
- Builds Anthropic message array with text, image content blocks (base64), and document content block (PDF) on the first message that carries a manual
- Returns: `ReadableStream` (Server-Sent Events / text stream)
- Model: `claude-sonnet-4-6`
- System prompt: watchmaking assistant context derived from watch skill (intermediate tone, correct terminology, all major movement families)

**`GET /api/manuals`**
- No params: returns JSON array of PDF filenames found in `Service Manuals/`
- `?file=xyz.pdf`: returns the raw PDF bytes for the frontend to cache and attach

---

## UI Layout

Dark workbench theme. Single-page, no sidebar.

```
┌─────────────────────────────────────────────────────┐
│  ⌚ Watchmaker                    [ETA 2824 ▾] [✕]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│   USER  ┌─────────────────────────────┐             │
│         │ what oil for the pallet     │             │
│         │ stones on this fork?        │             │
│         │ [🖼 IMG_0042.jpg]           │             │
│         └─────────────────────────────┘             │
│                                                     │
│   AI  Use Moebius 9415 on the locking faces         │
│       only — one needle-tip touch per stone...      │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ┌──────────────────────────────┐  [📎] [➤]        │
│  │ Ask anything or drop a photo │                   │
│  └──────────────────────────────┘                   │
│  [🖼 thumbnail ✕]                                   │
└─────────────────────────────────────────────────────┘
```

### Components

**Header**
- App name/logo
- `ManualSelector`: dropdown listing PDFs from `Service Manuals/`; selecting one fetches its bytes and caches them in state; active manual shown as a badge with ✕ dismiss

**ChatWindow**
- Scrollable list of `MessageBubble` components
- Auto-scrolls to bottom on new message
- Typing indicator (animated dots) while waiting for first stream token

**MessageBubble**
- User messages: right-aligned; shows text and image thumbnail if attached
- AI messages: left-aligned; markdown rendered (tables, bold headings, code blocks for service steps); tokens stream in as they arrive

**InputBar**
- Textarea: Enter to send, Shift+Enter for newline
- Paperclip button: opens file picker for image (JPEG/PNG)
- Drag-and-drop: accepts image files dropped anywhere on the page
- Staged image: thumbnail shown below textarea with ✕ to remove; one image per message
- Send button: disabled while a response is in flight

---

## Data Flow

1. User composes message (text + optional image). If a manual is active, its PDF bytes are already cached in state from when it was selected.
2. Frontend `POST /api/chat` with `{ messages, image?, manual? }`.
3. Route builds Anthropic request:
   - System prompt (watchmaking context)
   - Full conversation history as message objects
   - Current user message includes image content block if present
   - PDF attached as `document` content block on the first message it appears; not re-sent on subsequent turns (context window retains it)
4. Anthropic streams tokens back; route pipes as `ReadableStream`
5. Frontend appends tokens to the active AI bubble as they arrive
6. On completion, bubble is finalised and added to history

**Manual switching:** Selecting a new manual attaches it on the next outgoing message. A system-level note in that message signals the manual change to Claude.

**In-browser state only:** conversation history array, active manual name + PDF bytes, staged image. No writes to disk.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `ANTHROPIC_API_KEY` missing | Persistent banner on load; input disabled |
| Stream error mid-response | Partial bubble suffixed with `[response interrupted]`; input re-enabled |
| Image > 5 MB | Toast warning; file rejected before upload |
| PDF > 32 MB | Inline warning in manual selector; file not loaded |
| `Service Manuals/` empty | Selector shows disabled placeholder text |
| Request timeout (60 s) | Toast: "Request timed out — try again" |

---

## Out of Scope

- Session persistence / conversation history saved to disk
- Multiple simultaneous images per message
- PDF side-panel viewer
- Authentication
- Deployment / remote hosting
- Mobile-optimised layout
