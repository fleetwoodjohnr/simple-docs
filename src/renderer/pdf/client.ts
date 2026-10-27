import wasmUrl from '../../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm?url'
import type { AnnotInfo, AnnotKind, EditResult, FieldInfo, PageInfo, TextRun } from '@/pdf/engine'

// Promise-based client for the PDFium worker.

let worker: Worker | null = null
let ready: Promise<void> | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function call<T>(op: string, doc?: number, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ id, op, doc, args }, transfer)
  })
}

async function wasmBytes(): Promise<ArrayBuffer> {
  if (/^https?:/.test(wasmUrl) || /^https?:/.test(location.href)) return (await fetch(new URL(wasmUrl, location.href))).arrayBuffer()
  // Packaged app (file://): fetch() cannot read file: URLs, so the main process reads the bundled asset.
  return (await window.simpleDocs.readAsset(new URL(wasmUrl, location.href).href)).buffer as ArrayBuffer
}

export function ensureEngine(): Promise<void> {
  if (!ready) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const { id, result, error } = e.data as { id: number; result?: unknown; error?: string }
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (error) p.reject(new Error(error))
      else p.resolve(result)
    }
    ready = wasmBytes().then((wasm) => {
      const id = ++seq
      return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve: () => resolve(), reject })
        worker!.postMessage({ id, op: 'init', wasm }, [wasm])
      })
    })
  }
  return ready
}

export interface OpenedPdf {
  id: number
  pages: PageInfo[]
  title: string
  author: string
  subject: string
  keywords: string
}

/** Render a page to a PNG blob (scale = pixels per PDF point). */
export async function renderPng(doc: number, i: number, scale: number): Promise<Blob> {
  const img = await pdf.render(doc, i, scale)
  const canvas = new OffscreenCanvas(img.width, img.height)
  canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

export const pdf = {
  async open(bytes: Uint8Array, password = ''): Promise<OpenedPdf> {
    await ensureEngine()
    const copy = bytes.slice()
    return call('open', undefined, [copy, password], [copy.buffer])
  },
  close: (doc: number) => call<void>('close', doc, [doc]),
  pages: (doc: number) => call<PageInfo[]>('pages', doc),
  render: (doc: number, i: number, scale: number) => call<{ width: number; height: number; data: Uint8ClampedArray }>('render', doc, [i, scale]),
  runs: (doc: number, i: number) => call<TextRun[]>('runs', doc, [i]),
  lines: (doc: number, i: number) => call<TextRun[]>('lines', doc, [i]),
  search: (doc: number, q: string) => call<{ page: number; boxes: [number, number, number, number][] }[]>('search', doc, [q]),
  editText: (doc: number, i: number, charIndex: number, text: string, end?: number) => call<EditResult>('editText', doc, [i, charIndex, text, end]),
  addText: (doc: number, i: number, x: number, y: number, text: string, size: number) => call<boolean>('addText', doc, [i, x, y, text, size]),
  redact: (doc: number, i: number, rects: [number, number, number, number][]) => call<boolean>('redact', doc, [i, rects]),
  annotations: (doc: number, i: number) => call<AnnotInfo[]>('annotations', doc, [i]),
  addAnnotation: (doc: number, i: number, kind: Exclude<AnnotKind, 'other'>, opts: Record<string, unknown>) => call<boolean>('addAnnotation', doc, [i, kind, opts]),
  removeAnnotation: (doc: number, i: number, index: number) => call<boolean>('removeAnnotation', doc, [i, index]),
  fields: (doc: number, i: number) => call<FieldInfo[]>('fields', doc, [i]),
  setFieldValue: (doc: number, i: number, annot: number, value: string) => call<boolean>('setFieldValue', doc, [i, annot, value]),
  createField: (doc: number, i: number, type: 'text' | 'checkbox', name: string, rect: [number, number, number, number]) => call<boolean>('createField', doc, [i, type, name, rect]),
  addInvisibleText: (doc: number, i: number, words: { text: string; rect: [number, number, number, number] }[]) => call<boolean>('addInvisibleText', doc, [i, words]),
  addPng: (doc: number, i: number, png: Uint8Array, rect: [number, number, number, number]) => call<boolean>('addPng', doc, [i, png, rect]),
  rotate: (doc: number, i: number, deg: number) => call<void>('rotate', doc, [i, deg]),
  deletePage: (doc: number, i: number) => call<void>('deletePage', doc, [i]),
  insertBlank: (doc: number, at: number, w: number, h: number) => call<void>('insertBlank', doc, [at, w, h]),
  movePages: (doc: number, idx: number[], dest: number) => call<boolean>('movePages', doc, [idx, dest]),
  importBytes: (doc: number, bytes: Uint8Array, at: number) => call<boolean>('importBytes', doc, [bytes, at]),
  extract: (doc: number, idx: number[]) => call<Uint8Array>('extract', doc, [idx]),
  crop: (doc: number, i: number, box: [number, number, number, number]) => call<void>('crop', doc, [i, box]),
  setMeta: (doc: number, key: string, value: string) => call<boolean>('setMeta', doc, [key, value]),
  save: (doc: number) => call<Uint8Array>('save', doc)
}
