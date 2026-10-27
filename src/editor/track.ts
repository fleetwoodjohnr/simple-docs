import { Extension, Mark, type Editor } from '@tiptap/core'
import type { Mark as PMMark, MarkType, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

// Track changes. While the doc attribute `trackChanges` is on, user edits are rewritten
// right after they apply (same undo step): deleted content is put back and marked as a
// deletion, inserted content is marked as an insertion. Deleting your own pending
// insertion really deletes it. Formatting and structural edits (split/join) are not tracked.

export interface RevisionAttrs {
  author: string
  date: string
}

let authorFn: () => string = () => 'Author'
export const setTrackAuthor = (fn: () => string) => (authorFn = fn)

const revisionMark = (name: string, tag: string, cls: string) =>
  Mark.create({
    name,
    inclusive: false,
    addAttributes() {
      return {
        author: { default: '', parseHTML: (el) => el.getAttribute('data-author') ?? '' },
        date: { default: '', parseHTML: (el) => el.getAttribute('data-date') ?? '' }
      }
    },
    parseHTML() {
      return [{ tag: `${tag}[data-rev]` }]
    },
    renderHTML({ mark }) {
      return [tag, { 'data-rev': '', 'data-author': mark.attrs.author, 'data-date': mark.attrs.date, class: cls, title: `${mark.attrs.author}${mark.attrs.date ? ' · ' + new Date(mark.attrs.date).toLocaleString() : ''}` }, 0]
    }
  })

export const Insertion = revisionMark('insertion', 'ins', 'sd-ins')
export const Deletion = revisionMark('deletion', 'del', 'sd-del')

const trackKey = new PluginKey('trackChanges')
const INTERNAL = 'trackInternal'

function hasContent(doc: PMNode, from: number, to: number): boolean {
  let found = false
  doc.nodesBetween(from, to, (n) => {
    if (found) return false
    if (n.isText || (n.isInline && n.isAtom)) found = true
    return !found
  })
  return found
}

/** Add `mark` to inline content in [from, to) that does not already carry `skip`. */
function markInline(tr: Transaction, from: number, to: number, mark: PMMark, skip: MarkType) {
  tr.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isInline) return true
    if (skip.isInSet(n.marks)) return false
    tr.addMark(Math.max(from, pos), Math.min(to, pos + n.nodeSize), mark)
    return false
  })
}

/** Ranges in [from, to) holding an insertion by `author` (deleting those is a real delete). */
function ownInsertions(doc: PMNode, from: number, to: number, ins: MarkType, author: string): [number, number][] {
  const out: [number, number][] = []
  doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isInline) return true
    const m = ins.isInSet(n.marks)
    if (m && m.attrs.author === author) out.push([Math.max(from, pos), Math.min(to, pos + n.nodeSize)])
    return false
  })
  return out
}

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: trackKey,
        appendTransaction(trs, oldState, newState) {
          if (!newState.doc.attrs.trackChanges) return null
          const ins = newState.schema.marks.insertion
          const del = newState.schema.marks.deletion
          const author = authorFn()
          // Minute resolution so consecutive typing merges into one revision span.
          const date = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString()
          const atr = newState.tr
          let touched = false
          let cursor: number | null = null
          for (const tr of trs) {
            if (!tr.docChanged || tr.getMeta(INTERNAL) || tr.getMeta('pagination') || tr.getMeta('history$') || tr.getMeta('trackSkip')) continue
            for (let i = 0; i < tr.steps.length; i++) {
              const step = tr.steps[i]
              if (!(step instanceof ReplaceStep)) continue
              const before = tr.docs[i]
              const { from, to } = step as unknown as { from: number; to: number }
              const rest = tr.mapping.slice(i + 1)
              const start = atr.mapping.map(rest.map(from, -1), -1)
              const insEnd = atr.mapping.map(rest.map(from + step.slice.size, 1), 1)
              // Mark what was inserted.
              if (step.slice.size && hasContent(atr.doc, start, insEnd)) {
                markInline(atr, start, insEnd, ins.create({ author, date }), del)
                touched = true
              }
              // Put deleted content back, marked as deleted.
              if (to > from && hasContent(before, from, to)) {
                const slice = before.slice(from, to)
                const size0 = atr.doc.content.size
                atr.replace(start, start, slice)
                const end = start + (atr.doc.content.size - size0)
                markInline(atr, start, end, del.create({ author, date }), del)
                for (const [a, b] of ownInsertions(atr.doc, start, end, ins, author).reverse()) atr.delete(a, b)
                touched = true
                const sel = oldState.selection
                // Backspace leaves the caret before the struck text, Delete after it.
                if (sel.empty && sel.from === to) cursor = start
                else if (sel.empty && sel.from === from) cursor = atr.mapping.map(end)
              }
            }
          }
          if (!touched) return null
          if (cursor !== null) atr.setSelection(TextSelection.create(atr.doc, Math.min(cursor, atr.doc.content.size)))
          return atr.setMeta(INTERNAL, true)
        }
      })
    ]
  }
})

// ---------- review ----------

export interface Change {
  kind: 'insertion' | 'deletion'
  from: number
  to: number
  author: string
  date: string
}

export function listChanges(doc: PMNode): Change[] {
  const out: Change[] = []
  doc.descendants((n, pos) => {
    if (!n.isInline) return true
    for (const m of n.marks) {
      if (m.type.name !== 'insertion' && m.type.name !== 'deletion') continue
      const last = out[out.length - 1]
      if (last && last.kind === m.type.name && last.to === pos && last.author === m.attrs.author) last.to = pos + n.nodeSize
      else out.push({ kind: m.type.name as Change['kind'], from: pos, to: pos + n.nodeSize, author: m.attrs.author, date: m.attrs.date })
    }
    return false
  })
  return out
}

/** Accept or reject the given changes (all of them when omitted). */
export function resolveChanges(editor: Editor, accept: boolean, changes = listChanges(editor.state.doc)) {
  if (!changes.length) return false
  const { schema } = editor.state
  const tr = editor.state.tr.setMeta(INTERNAL, true)
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    const remove = (accept && c.kind === 'deletion') || (!accept && c.kind === 'insertion')
    if (remove) tr.delete(c.from, c.to)
    else tr.removeMark(c.from, c.to, schema.marks[c.kind])
  }
  editor.view.dispatch(tr)
  return true
}

/** Changes touching the current selection (or the change at the caret). */
export function changesAtSelection(editor: Editor): Change[] {
  const { from, to } = editor.state.selection
  return listChanges(editor.state.doc).filter((c) => c.from <= to && c.to >= from)
}

export function gotoChange(editor: Editor, dir: 1 | -1): boolean {
  const changes = listChanges(editor.state.doc)
  if (!changes.length) return false
  const head = editor.state.selection.from
  const target = dir > 0 ? changes.find((c) => c.from > head) ?? changes[0] : [...changes].reverse().find((c) => c.to < head) ?? changes[changes.length - 1]
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target.from, target.to)).scrollIntoView())
  editor.view.focus()
  return true
}

export function setTracking(editor: Editor, on: boolean) {
  editor.view.dispatch(editor.state.tr.setDocAttribute('trackChanges', on).setMeta(INTERNAL, true))
}
