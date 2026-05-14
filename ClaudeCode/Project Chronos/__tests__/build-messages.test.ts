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
