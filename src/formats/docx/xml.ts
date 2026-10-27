import { DOMParser as XDOMParser, XMLSerializer as XSerializer } from '@xmldom/xmldom'

// Pure-JS XML helpers so DOCX conversion runs in the renderer, workers and Node tests alike.

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  xml: 'http://www.w3.org/XML/1998/namespace'
} as const

export type El = Element

export function parseXml(text: string): Document {
  return new XDOMParser({ onError: () => {} }).parseFromString(text, 'text/xml') as unknown as Document
}

export function serialize(node: Node): string {
  return new XSerializer().serializeToString(node as never)
}

export function elements(el: Node | null | undefined): El[] {
  const out: El[] = []
  if (!el) return out
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as El)
  return out
}

export const is = (el: Node | null | undefined, ns: string, name: string): boolean =>
  !!el && el.nodeType === 1 && (el as El).namespaceURI === ns && (el as El).localName === name

export function child(el: Node | null | undefined, ns: string, name: string): El | null {
  if (!el) return null
  for (let c = el.firstChild; c; c = c.nextSibling) if (is(c, ns, name)) return c as El
  return null
}

export function children(el: Node | null | undefined, ns: string, name: string): El[] {
  return elements(el).filter((c) => is(c, ns, name))
}

/** First descendant with the given name (depth-first). */
export function find(el: Node | null | undefined, ns: string, name: string): El | null {
  if (!el) return null
  for (const c of elements(el)) {
    if (is(c, ns, name)) return c
    const f = find(c, ns, name)
    if (f) return f
  }
  return null
}

export function findAll(el: Node | null | undefined, ns: string, name: string, out: El[] = []): El[] {
  for (const c of elements(el)) {
    if (is(c, ns, name)) out.push(c)
    findAll(c, ns, name, out)
  }
  return out
}

export function attr(el: El | null | undefined, ns: string | null, name: string): string | null {
  if (!el) return null
  const v = ns ? el.getAttributeNS(ns, name) : el.getAttribute(name)
  return v === '' && !(ns ? el.hasAttributeNS(ns, name) : el.hasAttribute(name)) ? null : v
}

export const wval = (el: El | null | undefined) => attr(el, NS.w, 'val')

/** OOXML on/off property: present = true unless val is 0/false/off. Absent = null. */
export function onOff(el: El | null | undefined): boolean | null {
  if (!el) return null
  const v = wval(el)
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none')
}

export function num(v: string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function textOf(el: Node | null | undefined): string {
  if (!el) return ''
  if (el.nodeType === 3 || el.nodeType === 4) return el.nodeValue ?? ''
  let s = ''
  for (let c = el.firstChild; c; c = c.nextSibling) s += textOf(c)
  return s
}

export function escXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
}

// ---------- binary helpers ----------

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf'
}

export const mimeFromExt = (ext: string) => MIME[ext.toLowerCase()] ?? 'application/octet-stream'
export const extFromMime = (mime: string) => Object.entries(MIME).find(([, m]) => m === mime)?.[0] ?? 'bin'

export function parseDataUrl(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src)
  if (!m) return null
  return { mime: m[1], bytes: m[2] ? fromBase64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])) }
}

/** Intrinsic pixel size from PNG/JPEG/GIF/BMP/WebP headers. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) }
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) }
  if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (tag === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (tag === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
    if (tag === 'VP8L') {
      const v = dv.getUint32(21, true)
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      const len = dv.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) }
      i += 2 + len
    }
  }
  return null
}
