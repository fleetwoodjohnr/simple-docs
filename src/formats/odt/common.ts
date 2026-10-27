// Shared ODF helpers: namespaces and unit conversion.

export const ODF = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0'
} as const

export const ODF_DECL = Object.entries(ODF)
  .filter(([k]) => k !== 'manifest')
  .map(([k, v]) => `xmlns:${k}="${v}"`)
  .join(' ')

/** ODF length ("2.54cm", "1in", "12pt", "10mm", "0.5pc", "96px") → points. */
export function lenPt(v: string | null | undefined): number | null {
  if (!v) return null
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(v.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  const f = { cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pt: 1, pc: 12, px: 0.75 }[m[2] ?? 'pt'] ?? 1
  return Math.round(n * f * 100) / 100
}

export const pt = (v: number) => `${Math.round(v * 1000) / 1000}pt`

/** "Heading_20_1" → "Heading 1" (ODF encodes spaces in style names as _20_). */
export const decodeName = (s: string) => s.replace(/_([0-9a-f]{2})_/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
export const encodeName = (s: string) => s.replace(/[^A-Za-z0-9-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`)
