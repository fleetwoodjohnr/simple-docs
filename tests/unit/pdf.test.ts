import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init } from '@embedpdf/pdfium'
import { PdfEngine } from '@/pdf/engine'

const fixture = readFileSync(path.join(import.meta.dirname, '../fixtures/complex.pdf'))
let engine: PdfEngine
const pdftotext = (bytes: Uint8Array) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-pdf-'))
  const f = path.join(dir, 'x.pdf')
  writeFileSync(f, bytes)
  return execFileSync('pdftotext', [f, '-']).toString()
}
const hasPoppler = existsSync('/usr/bin/pdftotext')

beforeAll(async () => {
  const wasm = readFileSync(path.join(import.meta.dirname, '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))
  engine = new PdfEngine(await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } as never))
})

describe('PDF engine (PDFium)', () => {
  it('opens, measures, extracts text and renders', () => {
    const doc = engine.open(fixture)
    expect(doc.pageCount()).toBe(2)
    expect(doc.pageInfo(0)).toMatchObject({ width: 612, height: 792, rotation: 0 })
    expect(doc.text(0)).toContain('Fixture Report')
    const runs = doc.runs(0)
    expect(runs.some((r) => r.text.includes('Introduction'))).toBe(true)
    const img = doc.render(0, 0.5)
    expect(img.width).toBe(306)
    expect(Array.from(img.data).some((v, i) => i % 4 === 0 && v < 128)).toBe(true) // some dark pixels
    expect(doc.search('centered paragraph')[0]?.page).toBe(0)
    doc.close()
  })

  it.skipIf(!hasPoppler)('edits existing text in the content stream (not an overlay)', () => {
    const doc = engine.open(fixture)
    const run = doc.runs(0).find((r) => r.text.trim() === 'Introduction')!
    const res = doc.editText(0, run.start, 'Overview')
    expect(res.ok).toBe(true)
    const out = doc.save()
    doc.close()
    const txt = pdftotext(out)
    expect(txt).toContain('Overview')
    expect(txt).not.toContain('Introduction')
    const again = engine.open(out)
    expect(again.text(0)).toContain('Overview')
    again.close()
  })

  it('re-encodes text the subset font cannot represent with a substitute font', () => {
    const doc = engine.open(fixture)
    const run = doc.runs(0).find((r) => r.text.trim() === 'Introduction')!
    const res = doc.editText(0, run.start, 'Zyqwvx ÆØÅ 42')
    expect(res.ok).toBe(true)
    const again = engine.open(doc.save())
    expect(again.text(0)).toContain('Zyqwvx ÆØÅ 42')
    again.close()
    doc.close()
  })

  it.skipIf(!hasPoppler)('redacts securely: the text is removed from the file', () => {
    const doc = engine.open(fixture)
    const hit = doc.search('Centered paragraph.')[0]
    const [l, t, r, b] = hit.boxes[0]
    expect(doc.redact(0, [[l - 1, t + 1, r + 1, b - 1]])).toBe(true)
    const out = doc.save()
    doc.close()
    expect(pdftotext(out)).not.toContain('Centered')
    const again = engine.open(out)
    expect(again.text(0)).not.toContain('Centered')
    expect(again.text(0)).toContain('Fixture Report')
    again.close()
  })

  it('adds, lists and removes annotations', () => {
    const doc = engine.open(fixture)
    const hit = doc.search('Fixture Report')[0].boxes[0]
    expect(doc.addAnnotation(0, 'highlight', { rect: hit, quads: [hit], contents: 'Check the title', author: 'Reviewer' })).toBe(true)
    expect(doc.addAnnotation(0, 'note', { rect: [500, 700, 520, 720], contents: 'Sticky note' })).toBe(true)
    expect(doc.addAnnotation(0, 'ink', { rect: [100, 100, 200, 150], ink: [[[100, 100], [150, 140], [200, 110]]] })).toBe(true)
    const again = engine.open(doc.save())
    const anns = again.annotations(0)
    expect(anns.map((a) => a.kind)).toEqual(expect.arrayContaining(['highlight', 'note', 'ink']))
    expect(anns.find((a) => a.kind === 'highlight')).toMatchObject({ contents: 'Check the title', author: 'Reviewer' })
    expect(again.removeAnnotation(0, anns.find((a) => a.kind === 'note')!.index)).toBe(true)
    expect(again.annotations(0).some((a) => a.kind === 'note')).toBe(false)
    again.close()
    doc.close()
  })

  it('rotates, inserts, deletes, reorders, merges and extracts pages', () => {
    const doc = engine.open(fixture)
    doc.rotate(0, 90)
    expect(doc.pageInfo(0).rotation).toBe(90)
    doc.insertBlank(1, 595, 842)
    expect(doc.pageCount()).toBe(3)
    expect(doc.pageInfo(1)).toMatchObject({ width: 595, height: 842 })
    doc.movePages([2], 0)
    expect(doc.text(0)).toContain('Second page starts here')
    doc.deletePage(1)
    expect(doc.pageCount()).toBe(2)
    const other = engine.open(fixture)
    expect(doc.importPages(other, doc.pageCount())).toBe(true)
    expect(doc.pageCount()).toBe(4)
    other.close()
    const extracted = engine.open(doc.extract([0]))
    expect(extracted.pageCount()).toBe(1)
    expect(extracted.text(0)).toContain('Second page starts here')
    extracted.close()
    doc.close()
  })

  it('reads and writes metadata, and places images', () => {
    const doc = engine.open(fixture)
    expect(doc.getMeta('Title')).toBe('Fixture Report')
    doc.setMeta('Title', 'Renamed Report')
    // 2x2 red PNG
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMAAAA0EAf8cjU4kAAAAAElFTkSuQmCC', 'base64'))
    expect(doc.addPng(0, png, [400, 300, 480, 260])).toBe(true)
    const again = engine.open(doc.save())
    expect(again.getMeta('Title')).toBe('Renamed Report')
    again.close()
    doc.close()
  })
})
