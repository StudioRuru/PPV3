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
          <div className="flex gap-1 py-1" role="status" aria-label="Loading response">
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
