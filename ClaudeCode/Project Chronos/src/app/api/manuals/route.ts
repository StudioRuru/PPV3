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
  // Reject obviously bad filenames before filesystem access
  if (!filename.toLowerCase().endsWith('.pdf')) {
    throw new Error('Invalid filename')
  }
  const resolved = path.resolve(MANUALS_DIR, filename)
  if (!resolved.startsWith(MANUALS_DIR + path.sep)) {
    throw new Error('Invalid filename')
  }
  const bytes = await readFile(resolved)
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
      if (message === 'Invalid filename') {
        return new Response('Invalid filename', { status: 400 })
      }
      // ENOENT → 404, everything else → 500 with generic message
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT'
      return new Response(isNotFound ? 'Not found' : 'Server error', {
        status: isNotFound ? 404 : 500,
      })
    }
  }

  const files = await listManuals()
  return Response.json(files)
}
