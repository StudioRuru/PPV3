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
