# Watchmaker UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js chat interface for the watchmaker assistant — streaming Claude responses, image upload, and PDF service manual attachment.

**Architecture:** Next.js 15 App Router at the Project Chronos root. Two API routes handle Anthropic SDK calls (server-side, key never in browser) and PDF file serving from `Service Manuals/`. React client renders a dark-theme chat UI with markdown support and image upload.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, @anthropic-ai/sdk, react-markdown + remark-gfm, Jest + @testing-library/react

---

## File Map

| File | Responsibility |
|---|---|
| `src/lib/types.ts` | Shared TypeScript types (Message, ImageAttachment, ChatRequest) |
| `src/lib/system-prompt.ts` | Watchmaking system prompt string |
| `src/lib/build-messages.ts` | Pure function: convert frontend history → Anthropic message array |
| `src/app/api/manuals/route.ts` | List PDFs; serve PDF as base64 JSON |
| `src/app/api/chat/route.ts` | Stream Anthropic response |
| `src/components/ManualSelector.tsx` | PDF dropdown + active badge + dismiss |
| `src/components/MessageBubble.tsx` | Single message (user or AI, with markdown + image thumbnail) |
| `src/components/ChatWindow.tsx` | Scrollable message list, auto-scroll |
| `src/components/InputBar.tsx` | Textarea + image attach + drag-drop + send |
| `src/app/page.tsx` | Wires all components; owns messages/manual/loading state |
| `src/app/layout.tsx` | Dark background, font, page title |
| `src/app/globals.css` | Tailwind base + minimal custom styles |
| `__tests__/build-messages.test.ts` | Tests for message builder logic |
| `__tests__/manuals-route.test.ts` | Tests for manuals route handler |

---

## Task 1: Bootstrap Next.js Project

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `.env.local.example`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Scaffold the app**

Run in `Project Chronos/` root (answer Yes to any prompts):
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --skip-install
```
When asked about Turbopack, accept (Yes).

- [ ] **Step 2: Install dependencies**

```bash
npm install @anthropic-ai/sdk react-markdown remark-gfm
npm install --save-dev jest @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-environment-jsdom @types/jest ts-jest
```

- [ ] **Step 3: Add Jest config**

Create `jest.config.ts`:
```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
}

export default createJestConfig(config)
```

Create `jest.setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Create `.env.local.example`**

```
ANTHROPIC_API_KEY=your_api_key_here
```

Copy to `.env.local` and add your real key:
```bash
cp .env.local.example .env.local
```

- [ ] **Step 5: Update `next.config.ts`**

Replace its contents with:
```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
}

export default nextConfig
```

- [ ] **Step 6: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

html, body {
  height: 100%;
}
```

- [ ] **Step 7: Verify the project starts**

```bash
npm run dev
```
Expected: "Ready" message, `http://localhost:3000` loads the default Next.js page with no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: bootstrap Next.js watchmaker UI"
```

---

## Task 2: Types, System Prompt, and Message Builder

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/system-prompt.ts`
- Create: `src/lib/build-messages.ts`
- Create: `__tests__/build-messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/build-messages.test.ts`:
```typescript
import { buildMessages } from '../src/lib/build-messages'
import type { StoredMessage, ImageAttachment } from '../src/lib/types'

const textMsg = (text: string, role: 'user' | 'assistant' = 'user'): StoredMessage => ({
  id: '1', role, text
})

describe('buildMessages', () => {
  it('converts plain text history to Anthropic format', () => {
    const result = buildMessages([textMsg('hello'), textMsg('hi', 'assistant')], undefined, undefined)
    expect(result).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ])
  })

  it('injects image block into the last user message', () => {
    const img: ImageAttachment = { base64: 'abc123', mimeType: 'image/jpeg', name: 'test.jpg' }
    const result = buildMessages([textMsg('look at this')], img, undefined)
    expect(result[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } },
      { type: 'text', text: 'look at this' },
    ])
  })

  it('injects PDF document block into the first user message', () => {
    const result = buildMessages(
      [textMsg('check the manual'), textMsg('ok', 'assistant'), textMsg('more questions')],
      undefined,
      { name: 'ETA2824.pdf', base64: 'pdfdata' }
    )
    // PDF goes on first user message
    expect(result[0].content).toContainEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'pdfdata' },
    })
  })

  it('injects both image and PDF when both present', () => {
    const img: ImageAttachment = { base64: 'img64', mimeType: 'image/png', name: 'part.png' }
    const result = buildMessages(
      [textMsg('what is this?')],
      img,
      { name: 'manual.pdf', base64: 'pdf64' }
    )
    const types = (result[0].content as Array<{ type: string }>).map(b => b.type)
    expect(types).toContain('document')
    expect(types).toContain('image')
    expect(types).toContain('text')
  })
})
```

- [ ] **Step 2: Run test to see it fail**

```bash
npx jest __tests__/build-messages.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/lib/build-messages'`

- [ ] **Step 3: Create `src/lib/types.ts`**

```typescript
export type Role = 'user' | 'assistant'

export interface ImageAttachment {
  base64: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  name: string
}

export interface StoredMessage {
  id: string
  role: Role
  text: string
  image?: ImageAttachment
  isStreaming?: boolean
}

export interface ActiveManual {
  name: string
  base64: string
}

export interface ChatRequest {
  messages: StoredMessage[]
  image?: ImageAttachment
  manual?: ActiveManual
}
```

- [ ] **Step 4: Create `src/lib/build-messages.ts`**

```typescript
import type { StoredMessage, ImageAttachment, ActiveManual } from './types'

// Local types mirroring Anthropic SDK shape — avoids deep SDK type imports in tests
interface TextBlock { type: 'text'; text: string }
interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
interface DocumentBlock { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
type ContentBlock = TextBlock | ImageBlock | DocumentBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export function buildMessages(
  messages: StoredMessage[],
  currentImage: ImageAttachment | undefined,
  manual: ActiveManual | undefined
): AnthropicMessage[] {
  const firstUserIndex = messages.findIndex(m => m.role === 'user')

  return messages.map((msg, index) => {
    const isFirstUser = msg.role === 'user' && index === firstUserIndex
    const isLastMessage = index === messages.length - 1
    const blocks: ContentBlock[] = []

    // PDF attached to first user message only
    if (manual && isFirstUser) {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: manual.base64 },
      })
    }

    // Image: staged image on last message, or historical image from stored message
    if (currentImage && isLastMessage && msg.role === 'user') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: currentImage.mimeType, data: currentImage.base64 },
      })
    } else if (msg.image) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: msg.image.mimeType, data: msg.image.base64 },
      })
    }

    blocks.push({ type: 'text', text: msg.text })

    return { role: msg.role, content: blocks }
  })
}
```

- [ ] **Step 5: Create `src/lib/system-prompt.ts`**

```typescript
export const SYSTEM_PROMPT = `You are an expert watchmaking assistant with deep knowledge of mechanical watch movements, servicing, and repair. You help with movement identification, technical questions, lubrication, disassembly and reassembly, parts sourcing, and service manual interpretation.

Tone: intermediate-friendly. Use correct watchmaking terminology but explain it when the context calls for it. Be concise and precise — a fellow watchmaker's language, not a beginner's guide.

Movement families you know well:
- Swiss: ETA 2824-2, 2836-2, 2892-A2, 6497/6498, 7750; Sellita SW200/SW300; vintage Unitas, AS, FEF, Longines calibers
- Japanese: Seiko NH35/NH36, 4R35/4R36, 6R15, 7S26; Miyota 8215/8217, 9015
- Vintage pocket: Elgin, Waltham, Hamilton 992/912, Illinois

Lubrication expertise: You know the Moebius oil line (9010, 9020, D5, 8200, HP-1300, 9415/941) and exactly where each goes. You know what NOT to lubricate (balance staff pivots, impulse pin, banking pins).

When a user shares a photo of a movement or part:
- Identify what you can see (movement family, condition of pivots/jewels, damage)
- Comment on anything that looks worn, damaged, or incorrectly assembled
- Point out lubrication state if visible

When a service manual PDF is provided:
- Reference its specific diagrams, part numbers, and torque specs in your answers
- Cite page numbers or section names when directing the user to a specific section

Always be direct. Do not repeat the user's question. If you need more information to give a useful answer, ask one focused question.`
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest __tests__/build-messages.test.ts --no-coverage
```
Expected: 4 PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/ __tests__/build-messages.test.ts
git commit -m "feat: add types, system prompt, and message builder"
```

---

## Task 3: Manuals API Route

**Files:**
- Create: `src/app/api/manuals/route.ts`
- Create: `__tests__/manuals-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/manuals-route.test.ts`:
```typescript
import { listManuals, readManual } from '../src/app/api/manuals/route'
import * as fs from 'fs/promises'

jest.mock('fs/promises')
const mockReaddir = fs.readdir as jest.MockedFunction<typeof fs.readdir>
const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>

describe('listManuals', () => {
  it('returns only .pdf files', async () => {
    mockReaddir.mockResolvedValue(['ETA2824.pdf', 'notes.txt', 'Unitas6497.pdf'] as any)
    const result = await listManuals()
    expect(result).toEqual(['ETA2824.pdf', 'Unitas6497.pdf'])
  })

  it('returns empty array when folder is missing', async () => {
    mockReaddir.mockRejectedValue({ code: 'ENOENT' })
    const result = await listManuals()
    expect(result).toEqual([])
  })
})

describe('readManual', () => {
  it('returns base64 of the PDF', async () => {
    const fakeBytes = Buffer.from('fake pdf content')
    mockReadFile.mockResolvedValue(fakeBytes)
    const result = await readManual('ETA2824.pdf')
    expect(result).toBe(fakeBytes.toString('base64'))
  })

  it('throws on path traversal attempt', async () => {
    await expect(readManual('../secrets.pdf')).rejects.toThrow('Invalid filename')
    await expect(readManual('../../etc/passwd.pdf')).rejects.toThrow('Invalid filename')
  })

  it('throws on non-pdf filename', async () => {
    await expect(readManual('ETA2824.txt')).rejects.toThrow('Invalid filename')
  })
})
```

- [ ] **Step 2: Run test to see it fail**

```bash
npx jest __tests__/manuals-route.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Create `src/app/api/manuals/route.ts`**

```typescript
import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { NextRequest } from 'next/server'

const MANUALS_DIR = path.join(process.cwd(), 'Service Manuals')

export async function listManuals(): Promise<string[]> {
  try {
    const files = await readdir(MANUALS_DIR)
    return files.filter(f => f.toLowerCase().endsWith('.pdf'))
  } catch {
    return []
  }
}

export async function readManual(filename: string): Promise<string> {
  if (filename.includes('/') || filename.includes('..') || !filename.toLowerCase().endsWith('.pdf')) {
    throw new Error('Invalid filename')
  }
  const bytes = await readFile(path.join(MANUALS_DIR, filename))
  return bytes.toString('base64')
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')

  if (file) {
    try {
      const base64 = await readManual(file)
      return Response.json({ name: file, base64 })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error'
      const status = message === 'Invalid filename' ? 400 : 404
      return new Response(message, { status })
    }
  }

  const files = await listManuals()
  return Response.json(files)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/manuals-route.test.ts --no-coverage
```
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/manuals/ __tests__/manuals-route.test.ts
git commit -m "feat: add manuals API route with path traversal protection"
```

---

## Task 4: Chat API Route

**Files:**
- Create: `src/app/api/chat/route.ts`

- [ ] **Step 1: Create `src/app/api/chat/route.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { SYSTEM_PROMPT } from '@/lib/system-prompt'
import { buildMessages } from '@/lib/build-messages'
import type { ChatRequest } from '@/lib/types'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 500 })
  }

  const body: ChatRequest = await req.json()
  const { messages, image, manual } = body

  if (!messages?.length) {
    return new Response('No messages provided', { status: 400 })
  }

  const anthropicMessages = buildMessages(messages, image, manual)

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8096,
    system: SYSTEM_PROMPT,
    messages: anthropicMessages,
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

- [ ] **Step 2: Smoke-test the route manually**

Ensure `.env.local` has a real `ANTHROPIC_API_KEY`, then with `npm run dev` running:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","text":"What oil goes on pallet stones?"}]}' \
  --no-buffer
```
Expected: Streaming text response mentioning "9415".

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/
git commit -m "feat: add streaming chat API route"
```

---

## Task 5: ManualSelector Component

**Files:**
- Create: `src/components/ManualSelector.tsx`

- [ ] **Step 1: Create `src/components/ManualSelector.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

interface Props {
  activeManual: string | null
  onSelect: (name: string, base64: string) => void
  onDismiss: () => void
}

export function ManualSelector({ activeManual, onSelect, onDismiss }: Props) {
  const [manuals, setManuals] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/manuals')
      .then(r => r.json())
      .then(setManuals)
      .catch(() => setManuals([]))
  }, [])

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value
    if (!name) return
    setLoading(true)
    try {
      const res = await fetch(`/api/manuals?file=${encodeURIComponent(name)}`)
      const { base64 } = await res.json()
      onSelect(name, base64)
    } finally {
      setLoading(false)
    }
  }

  if (manuals.length === 0) {
    return (
      <span className="text-xs text-zinc-500 italic">
        No manuals — drop PDFs into Service Manuals/
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {!activeManual ? (
        <select
          onChange={handleChange}
          defaultValue=""
          disabled={loading}
          className="bg-zinc-800 border border-zinc-600 text-zinc-200 text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
        >
          <option value="" disabled>
            {loading ? 'Loading…' : 'Attach manual…'}
          </option>
          {manuals.map(m => (
            <option key={m} value={m}>{m.replace('.pdf', '')}</option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-1 bg-amber-900/40 border border-amber-700 rounded px-2 py-1">
          <span className="text-xs text-amber-300">{activeManual.replace('.pdf', '')}</span>
          <button
            onClick={onDismiss}
            className="text-amber-500 hover:text-amber-300 text-xs ml-1 leading-none"
            aria-label="Remove manual"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ManualSelector.tsx
git commit -m "feat: add ManualSelector component"
```

---

## Task 6: MessageBubble Component

**Files:**
- Create: `src/components/MessageBubble.tsx`

- [ ] **Step 1: Install typography plugin**

```bash
npm install @tailwindcss/typography
```

Next.js 15 uses **Tailwind CSS v4**, which configures plugins in CSS, not in `tailwind.config.ts`. Add the plugin to `src/app/globals.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

- [ ] **Step 2: Create `src/components/MessageBubble.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { StoredMessage } from '@/lib/types'

interface Props {
  message: StoredMessage
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-zinc-700 text-zinc-100'
            : 'bg-zinc-800/60 text-zinc-200'
        }`}
      >
        {message.image && (
          <img
            src={`data:${message.image.mimeType};base64,${message.image.base64}`}
            alt={message.image.name}
            className="max-w-xs max-h-48 rounded mb-2 object-contain"
          />
        )}

        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.text}</p>
        ) : message.isStreaming && !message.text ? (
          <div className="flex gap-1 py-1">
            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
          </div>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MessageBubble.tsx src/app/globals.css package.json package-lock.json
git commit -m "feat: add MessageBubble with markdown rendering"
```

---

## Task 7: ChatWindow Component

**Files:**
- Create: `src/components/ChatWindow.tsx`

- [ ] **Step 1: Create `src/components/ChatWindow.tsx`**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import type { StoredMessage } from '@/lib/types'

interface Props {
  messages: StoredMessage[]
}

export function ChatWindow({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm italic">
        Ask anything, or upload a photo of a movement or part.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChatWindow.tsx
git commit -m "feat: add ChatWindow with auto-scroll"
```

---

## Task 8: InputBar Component

**Files:**
- Create: `src/components/InputBar.tsx`

- [ ] **Step 1: Create `src/components/InputBar.tsx`**

```tsx
'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import type { ImageAttachment } from '@/lib/types'

interface Props {
  onSend: (text: string, image?: ImageAttachment) => void
  disabled: boolean
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

export function InputBar({ onSend, disabled }: Props) {
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<ImageAttachment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const attachFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Only image files can be attached.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image too large — must be under 5 MB.')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      setStaged({ base64, mimeType: file.type as ImageAttachment['mimeType'], name: file.name })
    }
    reader.readAsDataURL(file)
  }, [])

  useEffect(() => {
    function onDragOver(e: DragEvent) { e.preventDefault() }
    function onDrop(e: DragEvent) {
      e.preventDefault()
      const file = e.dataTransfer?.files[0]
      if (file) attachFile(file)
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [attachFile])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed && !staged) return
    onSend(trimmed, staged ?? undefined)
    setText('')
    setStaged(null)
    setError(null)
    textRef.current?.focus()
  }

  return (
    <div className="border-t border-zinc-700 px-4 py-3 bg-zinc-900">
      {error && (
        <p className="text-red-400 text-xs mb-2">{error}</p>
      )}
      {staged && (
        <div className="flex items-center gap-2 mb-2">
          <img
            src={`data:${staged.mimeType};base64,${staged.base64}`}
            alt={staged.name}
            className="h-12 w-12 object-cover rounded border border-zinc-600"
          />
          <span className="text-xs text-zinc-400 truncate max-w-xs">{staged.name}</span>
          <button
            onClick={() => setStaged(null)}
            className="text-zinc-500 hover:text-zinc-300 text-xs"
            aria-label="Remove image"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="Ask anything or drop a photo…"
          className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
          style={{ minHeight: '2.5rem', maxHeight: '8rem', overflowY: 'auto' }}
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) attachFile(f); e.target.value = '' }}
        />

        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled || !!staged}
          className="p-2 text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          aria-label="Attach image"
          title="Attach image"
        >
          📎
        </button>

        <button
          onClick={handleSend}
          disabled={disabled || (!text.trim() && !staged)}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/InputBar.tsx
git commit -m "feat: add InputBar with image attach and drag-drop"
```

---

## Task 9: Main Page and Layout

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Watchmaker',
  description: 'Watch movement service assistant',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${mono.variable} h-full bg-zinc-950 text-zinc-100 antialiased`}>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { ChatWindow } from '@/components/ChatWindow'
import { InputBar } from '@/components/InputBar'
import { ManualSelector } from '@/components/ManualSelector'
import type { StoredMessage, ImageAttachment, ActiveManual } from '@/lib/types'

export default function Home() {
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [manual, setManual] = useState<ActiveManual | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => { if (r.status === 500) setApiError('ANTHROPIC_API_KEY missing — add it to .env.local and restart.') })
      .catch(() => {})
  }, [])

  async function handleSend(text: string, image?: ImageAttachment) {
    const userMsg: StoredMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: text || '(image attached)',
      image,
    }
    const streamingMsg: StoredMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      isStreaming: true,
    }

    const nextMessages = [...messages, userMsg]
    setMessages([...nextMessages, streamingMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, image, manual: manual ?? undefined }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        setMessages(prev =>
          prev.map(m => m.id === streamingMsg.id ? { ...m, text: accumulated } : m)
        )
      }

      setMessages(prev =>
        prev.map(m => m.id === streamingMsg.id ? { ...m, isStreaming: false } : m)
      )
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === streamingMsg.id
            ? { ...m, text: m.text + ' [response interrupted]', isStreaming: false }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">⌚</span>
          <span className="font-mono text-sm font-semibold text-zinc-200 tracking-wide">Watchmaker</span>
        </div>
        <ManualSelector
          activeManual={manual?.name ?? null}
          onSelect={(name, base64) => setManual({ name, base64 })}
          onDismiss={() => setManual(null)}
        />
      </header>

      {/* API key warning */}
      {apiError && (
        <div className="bg-red-900/40 border-b border-red-800 px-4 py-2 text-red-300 text-xs">
          {apiError}
        </div>
      )}

      {/* Chat */}
      <ChatWindow messages={messages} />

      {/* Input */}
      <InputBar onSend={handleSend} disabled={loading} />
    </div>
  )
}
```

- [ ] **Step 3: Remove the default Next.js page content**

Delete `src/app/favicon.ico` placeholder styles are already replaced. Remove any leftover default assets if present:
```bash
rm -f src/app/page.module.css public/next.svg public/vercel.svg
```

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx
git commit -m "feat: wire up main page with chat, image upload, and manual selector"
```

---

## Task 10: End-to-End Smoke Test

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --no-coverage
```
Expected: All tests PASS (build-messages + manuals-route)

- [ ] **Step 2: Start the dev server and verify the golden path**

```bash
npm run dev
```
Open `http://localhost:3000`.

Check:
- [ ] Dark interface loads with no console errors
- [ ] Header shows "⌚ Watchmaker"
- [ ] Input bar present; placeholder text visible
- [ ] Type "What oil goes on pallet stones?" and press Enter — streaming response appears
- [ ] Response mentions 9415 and correct application technique

- [ ] **Step 3: Test image upload**

- [ ] Drag any JPEG/PNG onto the page — thumbnail appears in the input bar
- [ ] Send a message with the image — thumbnail appears in the chat bubble, AI responds referencing the image

- [ ] **Step 4: Test manual attachment**

- [ ] Drop any PDF into `Service Manuals/`
- [ ] Reload the page — manual selector appears in the header
- [ ] Select the manual — amber badge appears
- [ ] Ask a question — response should reference the document if relevant

- [ ] **Step 5: Test error states**

- [ ] Drop an image over 5 MB — error message appears, image not attached
- [ ] Dismiss manual — badge disappears, selector returns

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: watchmaker UI complete — chat, image upload, PDF manual context"
```
