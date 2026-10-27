import { init } from '@embedpdf/pdfium'
import { PdfEngine, type PdfDocument } from '@/pdf/engine'

// PDFium runs here, off the UI thread. Each request names a method on a PdfDocument.

let engine: PdfEngine | null = null
const docs = new Map<number, PdfDocument>()
let seq = 0

type Req = { id: number; op: string; doc?: number; args?: unknown[] }

const ops: Record<string, (doc: PdfDocument | undefined, args: unknown[]) => unknown> = {
  open: (_d, [bytes, password]) => {
    const d = engine!.open(bytes as Uint8Array, (password as string) ?? '')
    const id = ++seq
    docs.set(id, d)
    return { id, pages: Array.from({ length: d.pageCount() }, (_, i) => d.pageInfo(i)), title: d.getMeta('Title'), author: d.getMeta('Author'), subject: d.getMeta('Subject'), keywords: d.getMeta('Keywords') }
  },
  close: (d, [id]) => {
    d?.close()
    docs.delete(id as number)
  },
  pages: (d) => Array.from({ length: d!.pageCount() }, (_, i) => d!.pageInfo(i)),
  render: (d, [i, scale]) => d!.render(i as number, scale as number),
  runs: (d, [i]) => d!.runs(i as number),
  lines: (d, [i]) => d!.lines(i as number),
  search: (d, [q]) => d!.search(q as string),
  editText: (d, [i, c, t, end]) => d!.editText(i as number, c as number, t as string, end as number | undefined),
  addText: (d, [i, x, y, t, size]) => d!.addText(i as number, x as number, y as number, t as string, size as number),
  redact: (d, [i, rects]) => d!.redact(i as number, rects as [number, number, number, number][]),
  annotations: (d, [i]) => d!.annotations(i as number),
  addAnnotation: (d, [i, kind, opts]) => d!.addAnnotation(i as number, kind as never, opts as never),
  removeAnnotation: (d, [i, k]) => d!.removeAnnotation(i as number, k as number),
  fields: (d, [i]) => d!.fields(i as number),
  setFieldValue: (d, [i, k, v]) => d!.setFieldValue(i as number, k as number, v as string),
  createField: (d, [i, t, n, r]) => d!.createField(i as number, t as 'text' | 'checkbox', n as string, r as [number, number, number, number]),
  addPng: (d, [i, png, rect]) => d!.addPng(i as number, png as Uint8Array, rect as [number, number, number, number]),
  rotate: (d, [i, deg]) => d!.rotate(i as number, deg as number),
  deletePage: (d, [i]) => d!.deletePage(i as number),
  insertBlank: (d, [at, w, h]) => d!.insertBlank(at as number, w as number, h as number),
  movePages: (d, [idx, dest]) => d!.movePages(idx as number[], dest as number),
  importBytes: (d, [bytes, at]) => {
    const src = engine!.open(bytes as Uint8Array)
    try {
      return d!.importPages(src, at as number)
    } finally {
      src.close()
    }
  },
  extract: (d, [idx]) => d!.extract(idx as number[]),
  crop: (d, [i, box]) => d!.crop(i as number, box as [number, number, number, number]),
  setMeta: (d, [k, v]) => d!.setMeta(k as never, v as string),
  save: (d) => d!.save()
}

self.onmessage = async (e: MessageEvent<Req & { wasm?: ArrayBuffer }>) => {
  const { id, op, doc, args = [] } = e.data
  try {
    if (op === 'init') {
      engine ??= new PdfEngine(await init({ wasmBinary: e.data.wasm } as never))
      return self.postMessage({ id, result: true })
    }
    const fn = ops[op]
    if (!fn || !engine) throw new Error(`Unknown PDF operation ${op}`)
    const result = fn(doc != null ? docs.get(doc) : undefined, args)
    const transfer: Transferable[] = []
    if (result && typeof result === 'object' && 'data' in result && (result as { data: Uint8ClampedArray }).data?.buffer) transfer.push((result as { data: Uint8ClampedArray }).data.buffer as ArrayBuffer)
    if (result instanceof Uint8Array) transfer.push(result.buffer as ArrayBuffer)
    self.postMessage({ id, result }, { transfer })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}
