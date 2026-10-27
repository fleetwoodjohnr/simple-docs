import { generateHTML, type Extensions, type JSONContent } from '@tiptap/core'
import { createExtensions } from './extensions'
import { emptyHF, hfVariantFor, type DocMeta, type HeadersFooters, type HFKind, type PageSetup } from './model'
import { formatNumber } from './numbering'

// Static rendering of headers/footers for page sheets and print. Fields are
// substituted per page, so one HTML template serves every page.

let ext: Extensions | null = null
const extensions = () => (ext ??= createExtensions())
const cache = new WeakMap<object, string>()

export function hfOf(doc: { attrs: Record<string, unknown> }): HeadersFooters {
  return (doc.attrs.hf as HeadersFooters | null) ?? emptyHF()
}

export function pageLabel(page: PageSetup, pageIndex: number): string {
  const n = page.numbering
  return formatNumber((n?.start ?? 1) + pageIndex, n?.format ?? '1')
}

function template(content: unknown[]): string {
  let html = cache.get(content)
  if (html === undefined) {
    html = generateHTML({ type: 'doc', content: content as JSONContent[] }, extensions())
    cache.set(content, html)
  }
  return html
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** HTML for a page's header or footer, or '' when empty. */
export function renderHF(doc: { attrs: Record<string, unknown> }, kind: HFKind, pageIndex: number, pageCount: number): string {
  const hf = hfOf(doc)
  const variant = hfVariantFor(hf, pageIndex)
  const content = hf[kind][variant]
  if (!content?.length) return ''
  const page = doc.attrs.page as PageSetup
  const meta = (doc.attrs.meta ?? {}) as DocMeta
  const values: Record<string, string> = {
    page: pageLabel(page, pageIndex),
    pages: String(pageCount),
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    title: meta.title ?? '',
    author: meta.author ?? ''
  }
  return template(content).replace(/(<span[^>]*data-field="(\w+)"[^>]*>)[^<]*(<\/span>)/g, (_m, open, kind, close) => `${open}${esc(values[kind] ?? '')}${close}`)
}
