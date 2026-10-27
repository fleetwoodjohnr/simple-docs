import { generateHTML, generateJSON, type Extensions, type JSONContent } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { createExtensions } from '@/editor/extensions'
import { stylesToCss } from '@/editor/styles-css'
import type { DocMeta, PageSetup, StyleMap } from '@/editor/model'
import { Warnings, type ExportResult, type ImportResult } from './types'

// HTML adapter. Parsing goes through DOMPurify and then the editor schema, so only
// known, inert content survives. Requires a DOM (renderer or jsdom).

let ext: Extensions | null = null
const extensions = () => (ext ??= createExtensions())

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ['data-type', 'data-checked', 'data-style', 'data-label']
  }) as string
}

export function htmlToDoc(html: string): JSONContent {
  return generateJSON(sanitize(html), extensions())
}

export function docToHtml(doc: JSONContent): string {
  return generateHTML(doc, extensions())
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function importHtml(data: Uint8Array): ImportResult {
  const w = new Warnings()
  const text = new TextDecoder('utf-8').decode(data)
  const parsed = new DOMParser().parseFromString(text, 'text/html')
  const title = parsed.querySelector('title')?.textContent?.trim()
  parsed.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (!src.startsWith('data:')) w.add('loss', 'Linked images are not loaded (the app works offline); embed images to keep them')
  })
  if (parsed.querySelector('script')) w.add('info', 'Scripts were removed')
  const doc = htmlToDoc(parsed.body?.innerHTML ?? text)
  doc.attrs = { ...doc.attrs, meta: { title } }
  return { doc, warnings: w.list() }
}

/** Standalone HTML file with the document's styles inlined. */
export function exportHtml(doc: JSONContent): ExportResult {
  const styles = (doc.attrs?.styles ?? {}) as StyleMap
  const page = doc.attrs?.page as PageSetup | undefined
  const meta = (doc.attrs?.meta ?? {}) as DocMeta
  const body = docToHtml(doc)
  const width = page ? page.width - page.margins.left - page.margins.right : 468
  const css = `
body{margin:0;background:#f4f4f6}
.sd-doc{box-sizing:content-box;max-width:${width}pt;margin:40px auto;padding:48px 56px;background:#fff;white-space:pre-wrap;line-height:1.15}
.sd-doc :is(p,h1,h2,h3,h4,h5,h6){margin-top:0;font-size:inherit;font-weight:inherit;line-height:calc(var(--lhf,1.2)*var(--lh,1.15))}
.sd-doc table{border-collapse:collapse;width:100%}.sd-doc td,.sd-doc th{border:1px solid #bbb;padding:3pt 6pt;vertical-align:top}
.sd-doc img{max-width:100%;height:auto}.sd-doc blockquote{margin:0 0 8pt;padding-left:14pt;border-left:3px solid #ccc}
.sd-doc ul[data-type=taskList]{list-style:none;padding-left:4pt}.sd-doc ul[data-type=taskList] li{display:flex;gap:8px}
.sd-doc [data-page-break]{break-after:page}
${stylesToCss(styles, '.sd-doc')}`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="Simple Docs">
<title>${esc(meta.title ?? 'Document')}</title>
<style>${css}</style>
</head>
<body>
<article class="sd-doc">
${body}
</article>
</body>
</html>
`
  const w = new Warnings()
  const comments = doc.attrs?.comments as Record<string, unknown> | null
  if (comments && Object.keys(comments).length) w.add('loss', 'Comment threads are not kept in HTML (the commented text is)')
  const hf = doc.attrs?.hf as Record<string, { content?: unknown[] } | null> | null
  if (hf && Object.values(hf).some((v) => v && typeof v === 'object' && JSON.stringify(v).includes('"text"'))) w.add('loss', 'Headers and footers are not kept in HTML')
  const sources = doc.attrs?.sources as Record<string, unknown> | null
  if (sources && Object.keys(sources).length) w.add('loss', 'The sources list behind citations is not kept in HTML (each citation keeps its text)')
  return { data: new TextEncoder().encode(html), warnings: w.list() }
}
