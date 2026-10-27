import { Node, type Editor, type JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

// Citations and bibliography. Sources live in the doc attribute `sources`; each citation is an
// inline atom that stores its formatted text, refreshed whenever sources or the style change.
// The bibliography is a container of ordinary paragraphs, rebuilt on refresh.
// Styles: APA 7, MLA 9 and Chicago 17 author-date (the common cases; no year disambiguation).

export type CitationStyle = 'apa' | 'mla' | 'chicago'
export type SourceType = 'book' | 'article' | 'website' | 'report'

export interface Source {
  type: SourceType
  /** "Last, First Middle" for people; a name without a comma is an organization. */
  authors: string[]
  title: string
  year?: string
  /** Journal, website or series name. */
  container?: string
  publisher?: string
  volume?: string
  issue?: string
  pages?: string
  url?: string
  doi?: string
}

export type SourceMap = Record<string, Source>

export const CITATION_STYLES: { id: CitationStyle; label: string; heading: string }[] = [
  { id: 'apa', label: 'APA (7th)', heading: 'References' },
  { id: 'mla', label: 'MLA (9th)', heading: 'Works Cited' },
  { id: 'chicago', label: 'Chicago (author-date)', heading: 'References' }
]

// ---------- formatting ----------

const nameOf = (a: string) => {
  const i = a.indexOf(',')
  return i < 0 ? { last: a.trim(), first: '' } : { last: a.slice(0, i).trim(), first: a.slice(i + 1).trim() }
}
const initials = (first: string) =>
  first
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => (p.includes('-') ? p.split('-').map((q) => q[0] + '.').join('-') : p[0] + '.'))
    .join(' ')
const lastNames = (s: Source) => s.authors.filter((a) => a.trim()).map((a) => nameOf(a).last)
/** Join with commas and a final conjunction (Oxford comma for 3+). */
const join = (xs: string[], conj: string) => (xs.length < 2 ? xs.join('') : xs.length === 2 ? `${xs[0]} ${conj} ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, ${conj} ${xs[xs.length - 1]}`)
const period = (s: string) => (s && !/[.?!]$/.test(s) ? s + '.' : s)
const isRange = (p: string) => /[-–,]/.test(p)

function citeNames(s: Source, style: CitationStyle): string {
  const n = lastNames(s)
  if (!n.length) return s.type === 'book' || s.type === 'report' ? `*${s.title}*` : `“${s.title}”`
  if (n.length === 1) return n[0]
  if (n.length === 2) return `${n[0]} ${style === 'apa' ? '&' : 'and'} ${n[1]}`
  if (n.length === 3 && style === 'chicago') return join(n, 'and')
  return `${n[0]} et al.`
}

/** In-text citation, e.g. "(Lovelace, 1843, p. 12)" / "(Lovelace 12)" / "(Lovelace 1843, 12)". */
export function formatCitation(s: Source | undefined, style: CitationStyle, pages?: string | null): string {
  if (!s) return '(missing source)'
  const names = citeNames(s, style).replace(/\*/g, '')
  const year = s.year || 'n.d.'
  if (style === 'apa') return `(${names}, ${year}${pages ? `, ${isRange(pages) ? 'pp.' : 'p.'} ${pages}` : ''})`
  if (style === 'mla') return `(${names}${pages ? ` ${pages}` : ''})`
  return `(${names} ${year}${pages ? `, ${pages}` : ''})`
}

function listAuthors(s: Source, style: CitationStyle): string {
  const people = s.authors.filter((a) => a.trim()).map(nameOf)
  if (!people.length) return ''
  if (style === 'apa') {
    const f = people.map((p) => (p.first ? `${p.last}, ${initials(p.first)}` : p.last))
    return f.length === 1 ? f[0] : f.length === 2 ? `${f[0]}, & ${f[1]}` : `${f.slice(0, -1).join(', ')}, & ${f[f.length - 1]}`
  }
  const first = people[0].first ? `${people[0].last}, ${people[0].first}` : people[0].last
  const rest = people.slice(1).map((p) => (p.first ? `${p.first} ${p.last}` : p.last))
  if (style === 'mla') return people.length >= 3 ? `${first}, et al.` : rest.length ? `${first}, and ${rest[0]}` : first
  return rest.length ? join([first, ...rest], 'and').replace(/^([^,]+, [^,]+) and/, '$1, and') : first
}

type Piece = string | { i: string }
const I = (t?: string): Piece => ({ i: t ?? '' })

/** Reference-list entry as inline content (titles in italics). */
export function formatEntry(s: Source, style: CitationStyle): JSONContent[] {
  const authors = listAuthors(s, style)
  const year = s.year || 'n.d.'
  const link = s.doi ? `https://doi.org/${s.doi.replace(/^https?:\/\/doi\.org\//, '')}` : s.url ?? ''
  const article = s.type === 'article'
  const web = s.type === 'website'
  let parts: Piece[]
  if (style === 'apa') {
    // Without an author the title moves to the front: "Title. (Year)."
    const title: Piece = article ? period(s.title) : I(s.title)
    const head: Piece[] = authors ? [`${period(authors)} (${year}). `, title, article ? ' ' : '. '] : [title, article ? ' ' : '. ', `(${year}). `]
    if (article) parts = [...head, I(s.container), s.volume ? ', ' : '', I(s.volume), s.issue ? `(${s.issue})` : '', s.pages ? `, ${s.pages}` : '', s.container ? '.' : '', link ? ` ${link}` : '']
    else parts = [...head, web ? (s.container ? `${period(s.container)} ` : '') : s.publisher ? `${period(s.publisher)} ` : '', link]
  } else if (style === 'mla') {
    const head = authors ? `${period(authors)} ` : ''
    if (article) parts = [head, `“${period(s.title)}” `, I(s.container), s.volume ? `, vol. ${s.volume}` : '', s.issue ? `, no. ${s.issue}` : '', s.year ? `, ${s.year}` : '', s.pages ? `, pp. ${s.pages}` : '', '.', link ? ` ${link}.` : '']
    else if (web) parts = [head, `“${period(s.title)}” `, I(s.container), s.year ? `, ${s.year}` : '', link ? `, ${link}` : '', '.']
    else parts = [head, I(s.title), '.', s.publisher ? ` ${s.publisher}` : '', s.year ? `${s.publisher ? ',' : ''} ${s.year}` : '', s.publisher || s.year ? '.' : '']
  } else {
    const head = authors ? `${period(authors)} ${year}. ` : `${year}. `
    if (article) parts = [head, `“${period(s.title)}” `, I(s.container), s.volume ? ` ${s.volume}` : '', s.issue ? ` (${s.issue})` : '', s.pages ? `: ${s.pages}` : '', '.', link ? ` ${link}.` : '']
    else if (web) parts = [head, `“${period(s.title)}” `, s.container ? `${period(s.container)} ` : '', link ? `${link}.` : '']
    else parts = [head, I(s.title), '.', s.publisher ? ` ${period(s.publisher)}` : '', link ? ` ${link}.` : '']
  }
  const out: JSONContent[] = []
  for (const p of parts) {
    const text = typeof p === 'string' ? p : p.i
    if (!text) continue
    const marks = typeof p === 'string' ? undefined : [{ type: 'italic' }]
    const prev = out[out.length - 1]
    if (prev && JSON.stringify(prev.marks) === JSON.stringify(marks)) prev.text += text
    else out.push({ type: 'text', text, ...(marks ? { marks } : {}) })
  }
  if (out.length) out[out.length - 1].text = out[out.length - 1].text!.replace(/\s+$/, '')
  return out
}

/** Short Word-style tag: first three letters of the first author + two-digit year (deduplicated). */
export function makeTag(s: Source, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = ((lastNames(s)[0] ?? s.title).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3) || 'Src') + (s.year ?? '').slice(-2)
  if (!used.has(base)) return base
  for (let k = 1; ; k++) if (!used.has(`${base}${k}`)) return `${base}${k}`
}

const sortKey = (s: Source) => `${(lastNames(s)[0] ?? s.title).toLowerCase()} ${s.year ?? ''} ${s.title.toLowerCase()}`

// ---------- schema ----------

export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: { default: '', parseHTML: (el) => el.getAttribute('data-citation') ?? '' },
      pages: { default: null, parseHTML: (el) => el.getAttribute('data-pages') },
      text: { default: '', parseHTML: (el) => el.textContent ?? '' }
    }
  },
  // Its text counts as document text (search, word count, compare, plain-text copy).
  extendNodeSchema(extension) {
    return extension.name === 'citation' ? { leafText: (node: PMNode) => String(node.attrs.text ?? '') } : {}
  },
  renderText({ node }) {
    return String(node.attrs.text ?? '')
  },
  parseHTML() {
    return [{ tag: 'span[data-citation]' }]
  },
  renderHTML({ node }) {
    return ['span', { 'data-citation': node.attrs.source, ...(node.attrs.pages ? { 'data-pages': node.attrs.pages } : {}), class: 'sd-citation', contenteditable: 'false' }, node.attrs.text || '(citation)']
  }
})

export const Bibliography = Node.create({
  name: 'bibliography',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-bibliography]' }]
  },
  renderHTML() {
    return ['div', { 'data-bibliography': '', class: 'sd-bibliography' }, 0]
  }
})

// ---------- commands ----------

export const sourcesOf = (doc: PMNode): SourceMap => (doc.attrs.sources as SourceMap | null) ?? {}
export const styleOf = (doc: PMNode): CitationStyle => (doc.attrs.citationStyle as CitationStyle | null) ?? 'apa'

function bibliographyContent(editor: Editor, sources: SourceMap, style: CitationStyle): JSONContent[] {
  const heading = CITATION_STYLES.find((c) => c.id === style)!.heading
  const list = Object.values(sources).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  return [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: heading }] },
    ...(list.length
      ? list.map((s) => ({ type: 'paragraph', attrs: { indentLeft: 36, indentFirst: -36, ...(style === 'mla' || style === 'apa' ? { lineHeight: 2 } : {}) }, content: formatEntry(s, style) }))
      : [{ type: 'paragraph', content: [{ type: 'text', text: 'No sources yet. Add them in References → Manage sources.' }] }])
  ].map((j) => editor.schema.nodeFromJSON(j).toJSON() as JSONContent)
}

/** Re-format every citation and rebuild every bibliography from the current sources and style. */
export function refreshCitations(editor: Editor, tr: Transaction = editor.state.tr): Transaction {
  const sources = (tr.doc.attrs.sources as SourceMap | null) ?? {}
  const style = (tr.doc.attrs.citationStyle as CitationStyle | null) ?? 'apa'
  const bibs: { pos: number; node: PMNode }[] = []
  tr.doc.descendants((n, pos) => {
    if (n.type.name === 'citation') {
      // A citation whose source is unknown (e.g. imported) keeps the text it had.
      const text = sources[n.attrs.source] ? formatCitation(sources[n.attrs.source], style, n.attrs.pages) : n.attrs.text
      if (text !== n.attrs.text) tr.setNodeAttribute(pos, 'text', text)
    } else if (n.type.name === 'bibliography') bibs.push({ pos, node: n })
    return n.type.name !== 'bibliography'
  })
  const content = bibliographyContent(editor, sources, style)
  for (const b of bibs.reverse()) {
    const next = editor.schema.nodes.bibliography.create(null, content.map((c) => editor.schema.nodeFromJSON(c)))
    if (!next.eq(b.node)) tr.replaceWith(b.pos, b.pos + b.node.nodeSize, next)
  }
  return tr
}

export function saveSource(editor: Editor, source: Source, id?: string): string {
  const all = sourcesOf(editor.state.doc)
  const tag = id ?? makeTag(source, Object.keys(all))
  editor.view.dispatch(refreshCitations(editor, editor.state.tr.setDocAttribute('sources', { ...all, [tag]: source })))
  return tag
}

export function deleteSource(editor: Editor, id: string) {
  const { [id]: _gone, ...rest } = sourcesOf(editor.state.doc)
  editor.view.dispatch(refreshCitations(editor, editor.state.tr.setDocAttribute('sources', rest)))
}

export function setCitationStyle(editor: Editor, style: CitationStyle) {
  editor.view.dispatch(refreshCitations(editor, editor.state.tr.setDocAttribute('citationStyle', style)))
}

export function insertCitation(editor: Editor, id: string, pages?: string) {
  const text = formatCitation(sourcesOf(editor.state.doc)[id], styleOf(editor.state.doc), pages || null)
  editor.chain().focus().insertContent({ type: 'citation', attrs: { source: id, pages: pages || null, text } }).run()
}

export function insertBibliography(editor: Editor) {
  const content = bibliographyContent(editor, sourcesOf(editor.state.doc), styleOf(editor.state.doc))
  const $from = editor.state.selection.$from
  const at = $from.depth ? $from.after(1) : editor.state.doc.content.size
  editor.chain().focus().insertContentAt(at, { type: 'bibliography', content }).run()
}
