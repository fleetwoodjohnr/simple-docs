import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findParentNode } from '@tiptap/core'

// Table tools: visual table styles, sorting, column distribution and text↔table conversion.

export type TableStyle = 'grid' | 'plain' | 'lines' | 'striped'
export const TABLE_STYLES: { id: TableStyle; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'plain', label: 'Plain (no borders)' },
  { id: 'lines', label: 'Horizontal lines' },
  { id: 'striped', label: 'Striped rows' }
]

/** Adds the `tableStyle` attribute and exposes it to CSS through a node decoration (the table uses a node view). */
export const TableStyles = Extension.create({
  name: 'tableStyles',
  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          tableStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-table-style') || el.closest('[data-table-style]')?.getAttribute('data-table-style') || null,
            renderHTML: (a) => (a.tableStyle ? { 'data-table-style': a.tableStyle } : {})
          }
        }
      }
    ]
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((n, pos) => {
              if (n.type.name === 'table') {
                if (n.attrs.tableStyle) decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-table-style': n.attrs.tableStyle }))
                return false
              }
              return !n.isTextblock
            })
            return DecorationSet.create(state.doc, decos)
          }
        }
      })
    ]
  }
})

const tableAt = (editor: Editor) => findParentNode((n) => n.type.name === 'table')(editor.state.selection)

export function setTableStyle(editor: Editor, style: TableStyle) {
  const t = tableAt(editor)
  if (!t) return false
  editor.view.dispatch(editor.state.tr.setNodeAttribute(t.pos, 'tableStyle', style === 'grid' ? null : style))
  return true
}

const isHeaderRow = (row: PMNode) => row.childCount > 0 && row.content.content.every((c) => c.type.name === 'tableHeader')

/** Column index of the selection inside its row (accounting for colspans). */
function currentColumn(editor: Editor): number {
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d)
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      const row = $from.node(d - 1)
      let col = 0
      for (let i = 0; i < $from.index(d - 1); i++) col += row.child(i).attrs.colspan ?? 1
      return col
    }
  }
  return 0
}

function cellText(row: PMNode, col: number): string {
  let c = 0
  for (let i = 0; i < row.childCount; i++) {
    const cell = row.child(i)
    if (c === col) return cell.textContent.trim()
    c += cell.attrs.colspan ?? 1
  }
  return ''
}

/** Sort body rows by the selected column; header rows stay on top. Refuses tables with merged rows. */
export function sortTable(editor: Editor, descending = false): string | null {
  const t = tableAt(editor)
  if (!t) return 'Place the cursor in a table first'
  const rows: PMNode[] = []
  t.node.forEach((r) => rows.push(r))
  if (rows.some((r) => r.content.content.some((c) => (c.attrs.rowspan ?? 1) > 1))) return 'Tables with vertically merged cells cannot be sorted'
  const col = currentColumn(editor)
  const head = rows.filter(isHeaderRow)
  const body = rows.filter((r) => !isHeaderRow(r))
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const key = (r: PMNode) => cellText(r, col)
  const num = (s: string) => (/^[-+]?[$€£]?\s?[\d,.]+%?$/.test(s) ? parseFloat(s.replace(/[^\d.-]/g, '')) : NaN)
  body.sort((a, b) => {
    const na = num(key(a))
    const nb = num(key(b))
    const r = !isNaN(na) && !isNaN(nb) ? na - nb : collator.compare(key(a), key(b))
    return descending ? -r : r
  })
  const next = t.node.type.create(t.node.attrs, [...head, ...body])
  editor.view.dispatch(editor.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, next))
  return null
}

export function distributeColumns(editor: Editor): boolean {
  const t = tableAt(editor)
  if (!t) return false
  const tr = editor.state.tr
  t.node.descendants((n, pos) => {
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      if (n.attrs.colwidth) tr.setNodeAttribute(t.pos + 1 + pos, 'colwidth', null)
      return false
    }
    return true
  })
  editor.view.dispatch(tr)
  return true
}

/** Split a paragraph's inline content at tab characters (falling back to commas), keeping marks. */
function splitCells(p: JSONContent): JSONContent[][] {
  const content = p.content ?? []
  const plain = content.map((c) => c.text ?? '').join('')
  const sep = plain.includes('\t') ? '\t' : ','
  const cells: JSONContent[][] = [[]]
  for (const n of content) {
    if (n.type !== 'text') {
      cells[cells.length - 1].push(n)
      continue
    }
    const parts = (n.text ?? '').split(sep)
    parts.forEach((part, i) => {
      if (i > 0) cells.push([])
      const text = sep === ',' ? part.trim() : part
      if (text) cells[cells.length - 1].push({ ...n, text })
    })
  }
  return cells
}

export function textToTable(editor: Editor): string | null {
  const { from, to } = editor.state.selection
  const doc = editor.state.doc
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  const start = $from.depth >= 1 ? $from.before(1) : 0
  const end = $to.depth >= 1 ? $to.after(1) : doc.content.size
  const blocks: JSONContent[] = []
  doc.nodesBetween(start, end, (n) => {
    if (n.type.name === 'paragraph' || n.type.name === 'heading') blocks.push(n.toJSON())
    return !n.isTextblock
  })
  if (!blocks.length) return 'Select the paragraphs to convert'
  const rows = blocks.map(splitCells)
  const width = Math.max(...rows.map((r) => r.length))
  const table = {
    type: 'table',
    content: rows.map((r) => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, i) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: r[i]?.length ? r[i] : undefined }] }))
    }))
  }
  editor.chain().focus().insertContentAt({ from: start, to: end }, table).run()
  return null
}

export function tableToText(editor: Editor): boolean {
  const t = tableAt(editor)
  if (!t) return false
  const paras: JSONContent[] = []
  t.node.forEach((row) => {
    const content: JSONContent[] = []
    row.forEach((cell, _o, i) => {
      if (i) content.push({ type: 'text', text: '\t' })
      cell.forEach((b, _o2, j) => {
        if (j) content.push({ type: 'text', text: ' ' })
        if (b.isTextblock) b.forEach((inl) => content.push(inl.toJSON()))
        else content.push({ type: 'text', text: b.textContent })
      })
    })
    paras.push({ type: 'paragraph', content: content.filter((c) => c.type !== 'text' || c.text) })
  })
  editor.chain().focus().insertContentAt({ from: t.pos, to: t.pos + t.node.nodeSize }, paras).run()
  return true
}

export function setCellAlign(editor: Editor, v: 'top' | 'middle' | 'bottom') {
  return editor.chain().focus().setCellAttribute('verticalAlign', v === 'top' ? null : v).run()
}
