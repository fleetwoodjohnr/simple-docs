import { afterAll, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init } from '@embedpdf/pdfium'
import { PdfEngine } from '@/pdf/engine'
import { recognize, stopOcr } from '@/main/ocr'
import { hasPoppler } from '../tools'

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

it.skipIf(!hasPoppler)('on a rotated page, new text, images and OCR text are upright as displayed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-ocr-rot-'))
  const wasm = readFileSync(path.join(import.meta.dirname, '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))
  const engine = new PdfEngine(await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } as never))
  const dpi = 100
  const k = dpi / 72
  // Poppler renders the page as displayed (with /Rotate applied): what a reader would see.
  const shown = (bytes: Uint8Array, name: string) => {
    writeFileSync(path.join(dir, `${name}.pdf`), bytes)
    execFileSync('pdftoppm', ['-r', String(dpi), '-png', '-singlefile', path.join(dir, `${name}.pdf`), path.join(dir, name)])
    return readFileSync(path.join(dir, `${name}.png`))
  }
  const said = async (png: Uint8Array) => (await recognize(png)).map((w) => w.text).join(' ')

  // Portrait page shown rotated 90° clockwise: screen (x, y) is page (y, x).
  const doc = engine.create()
  doc.insertBlank(0, 612, 792)
  doc.rotate(0, 90)
  expect(doc.addText(0, 200, 72, 'Rotated page text', 28)).toBe(true)
  const shot = shown(doc.save(), 'text')
  expect(await said(shot)).toContain('Rotated page text')

  // A "scan" of that view placed on another rotated page, then recognized and mapped back.
  const scan = engine.create()
  scan.insertBlank(0, 612, 792)
  scan.rotate(0, 90)
  expect(scan.addPng(0, shot, [0, 792, 612, 0])).toBe(true)
  const words = await recognize(shown(scan.save(), 'scan'))
  expect(words.map((w) => w.text).join(' ')).toContain('Rotated page text')
  scan.addInvisibleText(0, words.map((w) => ({ text: w.text, rect: [w.bbox[1] / k, w.bbox[2] / k, w.bbox[3] / k, w.bbox[0] / k] as [number, number, number, number] })))
  const out = scan.save()
  writeFileSync(path.join(dir, 'out.pdf'), out)
  expect(execFileSync('pdftotext', [path.join(dir, 'out.pdf'), '-']).toString()).toContain('Rotated page text')
  // The hidden word lies over the drawn one: along page y (the screen's x axis), at page x ≈ 200.
  const [l, t, r, b] = engine.open(out).search('Rotated')[0].boxes[0]
  expect(t - b).toBeGreaterThan(r - l)
  expect(l).toBeGreaterThan(170)
  expect(r).toBeLessThan(215)
  expect(b).toBeGreaterThan(60)
  expect(b).toBeLessThan(90)
}, 120_000)

it.skipIf(!hasPoppler)('a value typed into a field we created is drawn, so other viewers show it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-field-'))
  const wasm = readFileSync(path.join(import.meta.dirname, '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))
  const engine = new PdfEngine(await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } as never))
  const created = engine.create()
  created.insertBlank(0, 612, 792)
  expect(created.createField(0, 'text', 'Name', [72, 700, 400, 680])).toBe(true)
  const doc = engine.open(created.save())
  doc.setFieldValue(0, doc.fields(0)[0].annotIndex, 'Hello field value')
  writeFileSync(path.join(dir, 'f.pdf'), doc.save())
  execFileSync('pdftoppm', ['-r', '100', '-png', '-singlefile', path.join(dir, 'f.pdf'), path.join(dir, 'f')])
  expect((await recognize(readFileSync(path.join(dir, 'f.png')))).map((w) => w.text).join(' ')).toContain('Hello field value')
}, 60_000)
