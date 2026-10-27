import { afterAll, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init } from '@embedpdf/pdfium'
import { PdfEngine } from '@/pdf/engine'
import { recognize, stopOcr } from '@/main/ocr'

const hasPoppler = existsSync('/usr/bin/pdftoppm')
afterAll(() => stopOcr())

it.skipIf(!hasPoppler)('OCR makes a scanned (image-only) page searchable without changing how it looks', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-ocr-'))
  const dpi = 150
  // A "scan": page 1 of the fixture rasterized, placed as the only content of a new PDF.
  execFileSync('pdftoppm', ['-r', String(dpi), '-png', '-f', '1', '-l', '1', '-singlefile', path.join(import.meta.dirname, '../fixtures/complex.pdf'), path.join(dir, 'scan')])
  const png = readFileSync(path.join(dir, 'scan.png'))
  const wasm = readFileSync(path.join(import.meta.dirname, '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))
  const engine = new PdfEngine(await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } as never))
  const doc = engine.create()
  doc.insertBlank(0, 612, 792)
  doc.addPng(0, png, [0, 792, 612, 0])
  const text = (bytes: Uint8Array) => (writeFileSync(path.join(dir, 'x.pdf'), bytes), execFileSync('pdftotext', [path.join(dir, 'x.pdf'), '-']).toString())
  expect(text(doc.save()).trim()).toBe('')

  const before = doc.render(0, 0.5).data
  const words = await recognize(png)
  const k = dpi / 72
  doc.addInvisibleText(0, words.map((w) => ({ text: w.text, rect: [w.bbox[0] / k, 792 - w.bbox[1] / k, w.bbox[2] / k, 792 - w.bbox[3] / k] as [number, number, number, number] })))
  const out = doc.save()
  const txt = text(out)
  expect(txt).toContain('Fixture Report')
  expect(txt).toContain('Centered paragraph')
  // Search hits land on the word in the image.
  const again = engine.open(out)
  const hit = again.search('Report')[0]
  expect(hit.page).toBe(0)
  const [l, t] = hit.boxes[0]
  expect(l).toBeGreaterThan(100)
  expect(l).toBeLessThan(260)
  expect(t).toBeGreaterThan(660)
  expect(t).toBeLessThan(720)
  // Invisible text: rendering is unchanged.
  const after = again.render(0, 0.5).data
  expect(Buffer.compare(Buffer.from(before), Buffer.from(after))).toBe(0)
}, 120_000)
