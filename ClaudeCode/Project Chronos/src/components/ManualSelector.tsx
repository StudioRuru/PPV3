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
  const [fetchError, setFetchError] = useState<string | null>(null)

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
    setFetchError(null)
    try {
      const res = await fetch(`/api/manuals?file=${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const { base64 } = await res.json()
      onSelect(name, base64)
    } catch {
      setFetchError('Failed to load manual — try again.')
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
      {fetchError && (
        <span className="text-xs text-red-400">{fetchError}</span>
      )}
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
