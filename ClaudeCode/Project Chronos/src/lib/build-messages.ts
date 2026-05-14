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
