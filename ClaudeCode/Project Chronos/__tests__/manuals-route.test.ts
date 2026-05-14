import { listManuals, readManual } from '../src/app/api/manuals/route'
import * as fs from 'fs/promises'

jest.mock('fs/promises')
const mockReaddir = fs.readdir as jest.MockedFunction<typeof fs.readdir>
const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>

describe('listManuals', () => {
  it('returns only .pdf files', async () => {
    mockReaddir.mockResolvedValue(['ETA2824.pdf', 'notes.txt', 'Unitas6497.pdf'] as any)
    const result = await listManuals()
    expect(result).toEqual(['ETA2824.pdf', 'Unitas6497.pdf'])
  })

  it('returns empty array when folder is missing', async () => {
    mockReaddir.mockRejectedValue({ code: 'ENOENT' })
    const result = await listManuals()
    expect(result).toEqual([])
  })
})

describe('readManual', () => {
  it('returns base64 of the PDF', async () => {
    const fakeBytes = Buffer.from('fake pdf content')
    mockReadFile.mockResolvedValue(fakeBytes)
    const result = await readManual('ETA2824.pdf')
    expect(result).toBe(fakeBytes.toString('base64'))
  })

  it('throws on path traversal attempt', async () => {
    await expect(readManual('../secrets.pdf')).rejects.toThrow('Invalid filename')
    await expect(readManual('../../etc/passwd.pdf')).rejects.toThrow('Invalid filename')
  })

  it('throws on non-pdf filename', async () => {
    await expect(readManual('ETA2824.txt')).rejects.toThrow('Invalid filename')
  })
})
