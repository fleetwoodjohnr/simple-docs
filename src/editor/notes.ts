import { Extension, Node } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { toRoman } from './numbering'

// Footnotes and endnotes: an inline atom carrying its own block content. References
// are numbered by document order; the layout engine reserves room for footnotes at
// the bottom of the page where their reference lands (endnotes go to the last page).

export type NoteKind = 'footnote' | 'endnote'

export interface NoteRef {
  pos: number
  kind: NoteKind
  label: string
  content: unknown[]
}

export function collectNotes(doc: PMNode): NoteRef[] {
  const out: NoteRef[] = []
  let fn = 0
  let en = 0
  doc.descendants((n, pos) => {
    if (n.type.name !== 'footnote') return true
    const kind = n.attrs.kind as NoteKind
    out.push({ pos, kind, label: kind === 'endnote' ? toRoman(++en) : String(++fn), content: (n.attrs.content as unknown[]) ?? [] })
    return false
  })
  return out
}

export const notesKey = new PluginKey<{ notes: NoteRef[]; deco: DecorationSet }>('notes')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: { insertNote: (kind: NoteKind) => ReturnType }
  }
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      kind: { default: 'footnote', parseHTML: (el) => (el.getAttribute('data-note') === 'endnote' ? 'endnote' : 'footnote') },
      content: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-content') ?? '[]')
          } catch {
            return []
          }
        },
        renderHTML: (a) => ({ 'data-content': JSON.stringify(a.content ?? []) })
      }
    }
  },
  parseHTML() {
    // Above the superscript mark's plain `sup` rule, or pasted/imported notes become empty superscript.
    return [{ tag: 'sup[data-note]', priority: 60 }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['sup', { ...HTMLAttributes, 'data-note': node.attrs.kind, class: 'sd-note-ref', contenteditable: 'false' }]
  },
  addCommands() {
    return {
      // Like Word, a note goes after the selection rather than replacing it.
      insertNote:
        (kind) =>
        ({ chain, state }) =>
          chain()
            .setTextSelection(state.selection.to)
            .insertContent({ type: 'footnote', attrs: { kind, content: [{ type: 'paragraph' }] } })
            .run()
    }
  },
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const notes = collectNotes(doc)
      const deco = DecorationSet.create(
        doc,
        notes.map((n) => Decoration.node(n.pos, n.pos + 1, { 'data-n': n.label }))
      )
      return { notes, deco }
    }
    return [
      new Plugin({
        key: notesKey,
        state: {
          init: (_c, s) => build(s.doc),
          apply: (tr, prev) => (tr.docChanged ? build(tr.doc) : prev)
        },
        props: { decorations: (s) => notesKey.getState(s)?.deco }
      })
    ]
  }
})

/** Clicking a note reference asks the app to open its editor. */
export const NoteClicks = Extension.create({
  name: 'noteClicks',
  addProseMirrorPlugins() {
    const open = (pos: number) => window.dispatchEvent(new CustomEvent('sd:open-note', { detail: pos }))
    return [
      new Plugin({
        props: {
          handleClickOn(_view, _pos, node, nodePos) {
            if (node.type.name !== 'footnote') return false
            open(nodePos)
            return true
          }
        }
      })
    ]
  }
})
