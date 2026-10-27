import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init } from '@embedpdf/pdfium'
import { PdfEngine } from '@/pdf/engine'

const fixture = readFileSync(path.join(import.meta.dirname, '../fixtures/complex.pdf'))
let engine: PdfEngine
const pdftotext = (bytes: Uint8Array, raw = false) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-pdf-'))
  const f = path.join(dir, 'x.pdf')
  writeFileSync(f, bytes)
  return execFileSync('pdftotext', [...(raw ? ['-raw'] : []), f, '-']).toString()
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
    // The embedded subset font cannot draw letters the document never used with it.
    expect(res.method).toBe('substitute-font')
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
    expect(doc.pageInfo(0)).toMatchObject({ rotation: 90, width: 792, height: 612 })
    expect(doc.render(0, 0.5)).toMatchObject({ width: 396, height: 306 })
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

describe('PDF line editing', () => {
  it('keeps the original font when the subset already has every character', () => {
    const doc = engine.open(fixture)
    const run = doc.runs(0).find((r) => r.text.trim() === 'Introduction')!
    const res = doc.editText(0, run.start, 'Intro')
    expect(res).toMatchObject({ ok: true, method: 'original-font' })
    doc.close()
  })

  it.skipIf(!hasPoppler)('replaces a whole line made of several text objects', () => {
    const doc = engine.open(fixture)
    const line = doc.lines(0).find((l) => l.text.startsWith('Plain text with'))!
    expect(line.end - line.start).toBeGreaterThan(10)
    const res = doc.editText(0, line.start, 'A completely rewritten first sentence.', line.end)
    expect(res.ok).toBe(true)
    // PDF text does not reflow: compare in content-stream order.
    const txt = pdftotext(doc.save(), true)
    expect(txt).toContain('A completely rewritten first sentence.')
    expect(txt).not.toContain('Plain text with')
    expect(txt).toContain('Centered paragraph.')
    doc.close()
  })
})

describe('PDF edit rendering', () => {
  /** Width (px) of dark ink within a horizontal band of the rendered page. */
  const inkWidth = (img: { width: number; height: number; data: Uint8ClampedArray }, top: number, bottom: number) => {
    let min = Infinity
    let max = -1
    for (let y = Math.max(0, top); y < Math.min(img.height, bottom); y++)
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4
        if (img.data[o] < 100 && img.data[o + 1] < 100 && img.data[o + 2] < 100) {
          min = Math.min(min, x)
          max = Math.max(max, x)
        }
      }
    return max >= 0 ? max - min : 0
  }

  it('draws every character of the replacement text', () => {
    const doc = engine.open(fixture)
    const run = doc.runs(0).find((r) => r.text.trim() === 'Introduction')!
    const [, top, , bottom] = run.box
    const band = (img: { height: number }) => [Math.round(img.height - top - 2), Math.round(img.height - bottom + 4)] as const
    const before = doc.render(0, 1)
    const wBefore = inkWidth(before, ...band(before))
    doc.editText(0, run.start, 'Overview')
    const after = doc.render(0, 1)
    const wAfter = inkWidth(after, ...band(after))
    // "Overview" has 8 of the 12 letters: its ink should be roughly 8/12 as wide, not a few stray glyphs.
    expect(wAfter / wBefore).toBeGreaterThan(0.5)
    expect(wAfter / wBefore).toBeLessThan(1.1)
    doc.close()
  })
})
