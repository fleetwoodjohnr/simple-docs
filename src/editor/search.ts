import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Find & replace: regex / case / whole-word / in-selection search over textblocks.

export interface SearchQuery {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Restrict to this range (search within selection). */
  range: { from: number; to: number } | null
}

export interface SearchState {
  query: SearchQuery
  matches: { from: number; to: number }[]
  current: number
  error: string | null
  deco: DecorationSet
}

export const searchKey = new PluginKey<SearchState>('search')

const EMPTY_QUERY: SearchQuery = { text: '', caseSensitive: false, wholeWord: false, regex: false, range: null }

export function buildRegex(q: SearchQuery): RegExp | null {
  if (!q.text) return null
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (q.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`
  return new RegExp(src, `gu${q.caseSensitive ? '' : 'i'}`)
}

export function findMatches(doc: PMNode, q: SearchQuery): { from: number; to: number }[] {
  const re = buildRegex(q)
  if (!re) return []
  const out: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => (text += child.isText ? child.text : '￼'.repeat(child.nodeSize)))
    const start = pos + 1
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0].length) {
        re.lastIndex++
        continue
      }
      const from = start + m.index
      const to = from + m[0].length
      if (!q.range || (from >= q.range.from && to <= q.range.to)) out.push({ from, to })
      if (out.length > 10000) return false
    }
    return false
  })
  return out
}

function compute(state: EditorState, query: SearchQuery, current: number): SearchState {
  let matches: { from: number; to: number }[] = []
  let error: string | null = null
  try {
    matches = findMatches(state.doc, query)
  } catch (e) {
    error = (e as Error).message
  }
  const cur = matches.length ? Math.min(Math.max(0, current), matches.length - 1) : -1
  const deco = DecorationSet.create(
    state.doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === cur ? 'find-match find-match-current' : 'find-match' }))
  )
  return { query, matches, current: cur, error, deco }
}

export function setSearch(tr: Transaction, query: Partial<SearchQuery>, current?: number) {
  return tr.setMeta(searchKey, { query, current })
}

export const Search = Extension.create({
  name: 'search',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: EMPTY_QUERY, matches: [], current: -1, error: null, deco: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(searchKey) as { query: Partial<SearchQuery>; current?: number } | undefined
            if (meta) return compute(state, { ...prev.query, ...meta.query }, meta.current ?? prev.current)
            if (tr.docChanged && prev.query.text) {
              const range = prev.query.range ? { from: tr.mapping.map(prev.query.range.from), to: tr.mapping.map(prev.query.range.to) } : null
              return compute(state, { ...prev.query, range }, prev.current)
            }
            return prev
          }
        },
        props: { decorations: (state) => searchKey.getState(state)?.deco }
      })
    ]
  }
})

/** Move to the next/previous match and select it. */
export function gotoMatch(state: EditorState, dir: 1 | -1): Transaction | null {
  const s = searchKey.getState(state)
  if (!s?.matches.length) return null
  const head = state.selection.from
  let idx = s.current
  if (idx < 0 || state.selection.from !== s.matches[idx]?.from) {
    idx = dir > 0 ? s.matches.findIndex((m) => m.from >= head) : [...s.matches].reverse().findIndex((m) => m.from < head)
    if (dir < 0 && idx >= 0) idx = s.matches.length - 1 - idx
    if (idx < 0) idx = dir > 0 ? 0 : s.matches.length - 1
  } else idx = (idx + dir + s.matches.length) % s.matches.length
  const m = s.matches[idx]
  return setSearch(state.tr.setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView(), {}, idx)
}

function replacementFor(state: EditorState, m: { from: number; to: number }, replace: string): string {
  const s = searchKey.getState(state)!
  if (!s.query.regex) return replace
  const re = buildRegex(s.query)!
  const text = state.doc.textBetween(m.from, m.to, '￼', '￼')
  return text.replace(new RegExp(re.source, re.flags.replace('g', '')), replace)
}

export function replaceCurrent(state: EditorState, replace: string): Transaction | null {
  const s = searchKey.getState(state)
  const m = s?.matches[s.current]
  if (!m) return null
  const marks = state.doc.resolve(m.from + 1).marks()
  const text = replacementFor(state, m, replace)
  const tr = state.tr
  if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks))
  else tr.delete(m.from, m.to)
  return tr
}

export function replaceAll(state: EditorState, replace: string): { tr: Transaction; count: number } | null {
  const s = searchKey.getState(state)
  if (!s?.matches.length) return null
  const tr = state.tr
  for (const m of [...s.matches].reverse()) {
    const marks = state.doc.resolve(m.from + 1).marks()
    const text = replacementFor(state, m, replace)
    if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks))
    else tr.delete(m.from, m.to)
  }
  return { tr, count: s.matches.length }
}
