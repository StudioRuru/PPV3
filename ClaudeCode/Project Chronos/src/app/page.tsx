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
