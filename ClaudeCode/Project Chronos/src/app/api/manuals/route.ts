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
