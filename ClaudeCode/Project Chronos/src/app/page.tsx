'use client'

import { useState, useEffect } from 'react'
import { ChatWindow } from '@/components/ChatWindow'
import { InputBar } from '@/components/InputBar'
import { ManualSelector } from '@/components/ManualSelector'
import { ServiceGuideViewer } from '@/components/ServiceGuide/ServiceGuideViewer'
import { TimegrapherView } from '@/components/Timegrapher/TimegrapherView'
import { TeardownView } from '@/components/Teardown/TeardownView'
import { guides } from '@/data/guides'
import { eta2892a2Teardown } from '@/data/guides/eta-2892a2-teardown'
import type { StoredMessage, ImageAttachment, ActiveManual } from '@/lib/types'

type View = 'chat' | 'guide' | 'timegrapher' | 'teardown'

export default function Home() {
  const [view, setView] = useState<View>('chat')
  const [guideFocus, setGuideFocus] = useState<string | null>(null)
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [manual, setManual] = useState<ActiveManual | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => { if (r.status === 500) setApiError('ANTHROPIC_API_KEY missing — add it to .env.local and restart.') })
      .catch(() => {})
  }, [])

  async function handleEnd() {
    setMessages([])
    setManual(null)
    await fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
    setStopped(true)
  }

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

  function handleInterpretReading(text: string) {
    setView('chat')
    void handleSend(text)
  }

  if (stopped) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
        <span className="text-4xl">⌚</span>
        <p className="text-sm">Server stopped. You may close this tab.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⌚</span>
            <span className="font-mono text-sm font-semibold text-zinc-200 tracking-wide">Watchmaker</span>
          </div>
          {/* View toggle */}
          <div className="flex rounded-md border border-zinc-800 p-0.5 text-xs">
            <button
              onClick={() => setView('chat')}
              className={`rounded px-2 py-1 transition-colors ${view === 'chat' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Chat
            </button>
            <button
              onClick={() => setView('guide')}
              className={`rounded px-2 py-1 transition-colors ${view === 'guide' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Service Guide
            </button>
            <button
              onClick={() => setView('teardown')}
              className={`rounded px-2 py-1 transition-colors ${view === 'teardown' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Teardown
            </button>
            <button
              onClick={() => setView('timegrapher')}
              className={`rounded px-2 py-1 transition-colors ${view === 'timegrapher' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Timegrapher
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {view === 'chat' && (
            <ManualSelector
              activeManual={manual?.name ?? null}
              onSelect={(name, base64) => setManual({ name, base64 })}
              onDismiss={() => setManual(null)}
            />
          )}
          <button
            onClick={handleEnd}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-40 transition-colors"
            title="End session and stop server"
          >
            End
          </button>
        </div>
      </header>

      {/* API key warning */}
      {apiError && (
        <div className="bg-red-900/40 border-b border-red-800 px-4 py-2 text-red-300 text-xs">
          {apiError}
        </div>
      )}

      {view === 'guide' ? (
        <ServiceGuideViewer guide={guides['eta-2892a2']} onOpenTimegrapher={() => setView('timegrapher')} focusStepId={guideFocus} />
      ) : view === 'teardown' ? (
        <TeardownView
          guide={guides['eta-2892a2']}
          timeline={eta2892a2Teardown}
          onOpenStepInGuide={(stepId) => { setGuideFocus(stepId); setView('guide') }}
        />
      ) : view === 'timegrapher' ? (
        <TimegrapherView guide={guides['eta-2892a2']} onInterpret={handleInterpretReading} />
      ) : (
        <>
          {/* Chat */}
          <ChatWindow messages={messages} />

          {/* Input */}
          <InputBar onSend={handleSend} disabled={loading} />
        </>
      )}
    </div>
  )
}
