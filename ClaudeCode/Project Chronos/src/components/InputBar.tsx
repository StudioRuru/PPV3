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
