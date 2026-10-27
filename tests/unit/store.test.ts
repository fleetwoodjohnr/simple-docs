import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { atomicWrite } from '@/main/store'

const dir = mkdtempSync(path.join(tmpdir(), 'sd-store-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('atomic saves', () => {
  it('replaces the file in one step', async () => {
    const f = path.join(dir, 'a.docx')
    writeFileSync(f, 'old')
    await atomicWrite(f, new TextEncoder().encode('new contents'))
    expect(readFileSync(f, 'utf8')).toBe('new contents')
    expect(readdirSync(dir)).toEqual(['a.docx'])
  })

  it('a failed write keeps the original and leaves no temp file', async () => {
    const f = path.join(dir, 'b.docx')
    writeFileSync(f, 'precious')
    await expect(atomicWrite(f, 42 as unknown as string)).rejects.toThrow()
    expect(readFileSync(f, 'utf8')).toBe('precious')
    expect(readdirSync(dir).filter((n) => n.includes('b.docx'))).toEqual(['b.docx'])
  })

  it('concurrent saves never interleave', async () => {
    const f = path.join(dir, 'c.txt')
    const bodies = Array.from({ length: 12 }, (_, i) => String(i).repeat(200_000))
    await Promise.all(bodies.map((b) => atomicWrite(f, b)))
    expect(bodies).toContain(readFileSync(f, 'utf8'))
    expect(readdirSync(dir).filter((n) => n.includes('c.txt'))).toEqual(['c.txt'])
  })
})
