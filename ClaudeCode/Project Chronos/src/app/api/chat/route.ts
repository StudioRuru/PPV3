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
    messages: anthropicMessages as Anthropic.MessageParam[],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
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
