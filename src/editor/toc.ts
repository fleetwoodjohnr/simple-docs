import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { paginationKey } from '@/layout/plugin'
import { pageLabel } from './numbering'
import type { PageSetup } from './model'

// Table of contents: a container of editable entry paragraphs. Page numbers come
// from the live pagination, so "Update table" reflects exactly what prints.

export const TocEntry = Node.create({
  name: 'tocEntry',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: { default: 1, parseHTML: (el) => Number(el.getAttribute('data-level')) || 1 },
      page: { default: '', parseHTML: (el) => el.getAttribute('data-page') ?? '' },
      /** Index of the heading this entry points at (among outline headings). */
      target: { default: null, parseHTML: (el) => (el.hasAttribute('data-target') ? Number(el.getAttribute('data-target')) : null) }
    }
  },
  parseHTML() {
    return [{ tag: 'div.toc-entry', contentElement: 'span.toc-text' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'toc-entry', 'data-level': node.attrs.level, 'data-page': node.attrs.page, ...(node.attrs.target != null ? { 'data-target': node.attrs.target } : {}) }),
      ['span', { class: 'toc-text' }, 0],
      ['span', { class: 'toc-dots', contenteditable: 'false' }],
      ['span', { class: 'toc-page', contenteditable: 'false' }, String(node.attrs.page)]
    ]
  }
})

export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  content: 'tocEntry+',
  defining: true,
  isolating: true,
  addAttributes() {
    return { maxLevel: { default: 3, parseHTML: (el) => Number(el.getAttribute('data-max-level')) || 3 } }
  },
  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-toc': '', 'data-max-level': node.attrs.maxLevel, class: 'sd-toc' }, 0]
  }
})

export interface HeadingRef {
  level: number
  text: string
  pos: number
}

export function outlineHeadings(doc: PMNode, maxLevel = 9): HeadingRef[] {
  const out: HeadingRef[] = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'toc') return false
    if (n.type.name === 'heading' && n.attrs.level <= maxLevel && n.textContent.trim()) out.push({ level: n.attrs.level, text: n.textContent.trim(), pos })
    return !n.isTextblock
  })
  return out
}

function entriesFor(editor: Editor, maxLevel: number): PMNode[] {
  const { schema, doc } = editor.state
  const breaks = paginationKey.getState(editor.state)?.breaks ?? []
  const page = doc.attrs.page as PageSetup
  return outlineHeadings(doc, maxLevel).map((h, i) => {
    const idx = breaks.filter((b) => b.pos <= h.pos).length
    return schema.nodes.tocEntry.create({ level: h.level, page: pageLabel(page, idx), target: i }, schema.text(h.text))
  })
}

/** Rebuild every TOC in the document. Returns true if anything changed. */
export function updateTocs(editor: Editor): boolean {
  const tr = editor.state.tr
  const tocs: { pos: number; node: PMNode }[] = []
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'toc') tocs.push({ pos, node: n })
    return n.type.name !== 'toc'
  })
  let changed = false
  for (const t of tocs.reverse()) {
    const entries = entriesFor(editor, t.node.attrs.maxLevel)
    const content = entries.length ? entries : [editor.schema.nodes.tocEntry.create({ level: 1 }, editor.schema.text('No headings found — apply heading styles, then update.'))]
    const next = t.node.type.create(t.node.attrs, content)
    if (next.eq(t.node)) continue
    changed = true
    tr.replaceWith(t.pos, t.pos + t.node.nodeSize, next)
  }
  if (changed) editor.view.dispatch(tr)
  return changed
}

/** Page numbers depend on the TOC's own length, so update until stable (a few layout passes). */
export function updateTocsSettled(editor: Editor, passes = 3) {
  if (!updateTocs(editor) || passes <= 1) return
  setTimeout(() => !editor.isDestroyed && updateTocsSettled(editor, passes - 1), 120)
}

export function insertToc(editor: Editor, maxLevel = 3) {
  const { schema } = editor.state
  const title = schema.nodes.paragraph.create({ styleId: 'TOCHeading' }, schema.text('Contents'))
  const toc = schema.nodes.toc.create({ maxLevel }, [schema.nodes.tocEntry.create({ level: 1 }, schema.text('…'))])
  const after = editor.state.selection.$from.after(1)
  editor.chain().focus().insertContentAt(after, [title.toJSON(), toc.toJSON()]).run()
  updateTocsSettled(editor)
}

/** Ctrl/Cmd + click on an entry jumps to its heading. */
export const TocNavigation = Extension.create({
  name: 'tocNavigation',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClickOn(view, _pos, node, _nodePos, event) {
            if (node.type.name !== 'tocEntry' || !(event.ctrlKey || event.metaKey) || node.attrs.target == null) return false
            const h = outlineHeadings(view.state.doc)[node.attrs.target]
            if (!h) return false
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(h.pos + 1))).scrollIntoView())
            return true
          }
        }
      })
    ]
  }
})
