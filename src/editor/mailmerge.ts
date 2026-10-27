import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Mail merge: «field» placeholders filled from a CSV data source, previewed in place and
// merged into one new document (one copy per record, separated by page breaks).

export interface MergeData {
  name: string
  fields: string[]
  rows: Record<string, string>[]
}

/** RFC 4180 CSV (quoted fields, "" escapes, newlines in quotes); delimiter detected among , ; and tab. */
export function parseCsv(text: string): { fields: string[]; rows: Record<string, string>[] } {
  text = text.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delim) row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      records.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) row.push(cell), records.push(row)
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''))
  const header = (nonEmpty.shift() ?? []).map((h, i) => h.trim() || `Column ${i + 1}`)
  return { fields: header, rows: nonEmpty.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) }
}

export const MergeField = Node.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: '', parseHTML: (el) => el.getAttribute('data-merge-field') ?? '' } }
  },
  extendNodeSchema(extension) {
    return extension.name === 'mergeField' ? { leafText: (node: PMNode) => `«${node.attrs.name}»` } : {}
  },
  parseHTML() {
    return [{ tag: 'span[data-merge-field]' }]
  },
  renderHTML({ node }) {
    return ['span', { 'data-merge-field': node.attrs.name, class: 'sd-merge-field', contenteditable: 'false' }, `«${node.attrs.name}»`]
  }
})

/** Preview: the «field» chips are hidden and the current record's values shown in their place (with the field's formatting). */
export const mergePreviewKey = new PluginKey<Record<string, string> | null>('mergePreview')
export const MergePreview = Extension.create({
  name: 'mergePreview',
  addProseMirrorPlugins() {
    return [
      new Plugin<Record<string, string> | null>({
        key: mergePreviewKey,
        state: { init: () => null, apply: (tr, v) => (tr.getMeta(mergePreviewKey) !== undefined ? tr.getMeta(mergePreviewKey) : v) },
        props: {
          decorations(state) {
            const record = mergePreviewKey.getState(state)
            if (!record) return null
            const decos: Decoration[] = []
            state.doc.descendants((n, pos) => {
              if (n.type.name !== 'mergeField') return true
              const value = record[n.attrs.name] ?? ''
              decos.push(Decoration.node(pos, pos + 1, { class: 'sd-merge-hidden' }))
              decos.push(
                Decoration.widget(
                  pos,
                  () => Object.assign(document.createElement('span'), { className: 'sd-merge-value', textContent: value }),
                  { side: -1, marks: n.marks, key: `mv${pos}${value}` }
                )
              )
              return true
            })
            return DecorationSet.create(state.doc, decos)
          }
        }
      })
    ]
  }
})

export function setMergePreview(editor: Editor, record: Record<string, string> | null) {
  editor.view.dispatch(editor.state.tr.setMeta(mergePreviewKey, record).setMeta('addToHistory', false))
}

export function insertMergeField(editor: Editor, name: string) {
  editor.chain().focus().insertContent({ type: 'mergeField', attrs: { name } }).run()
}

export function mergeFieldsIn(doc: JSONContent): string[] {
  const out = new Set<string>()
  const walk = (n: JSONContent) => (n.type === 'mergeField' ? out.add(String(n.attrs?.name)) : n.content?.forEach(walk))
  walk(doc)
  return [...out]
}

/** One copy of the document per record, fields replaced by their values (keeping the field's formatting). */
export function mergeDocuments(doc: JSONContent, rows: Record<string, string>[]): JSONContent {
  const fill = (n: JSONContent, row: Record<string, string>): JSONContent[] => {
    if (n.type === 'mergeField') {
      const v = row[String(n.attrs?.name)] ?? ''
      return v ? [{ type: 'text', text: v, ...(n.marks ? { marks: n.marks } : {}) }] : []
    }
    if (!n.content) return [n]
    return [{ ...n, content: n.content.flatMap((c) => fill(c, row)) }]
  }
  const content: JSONContent[] = []
  rows.forEach((row, i) => {
    if (i) content.push({ type: 'pageBreak' })
    for (const block of doc.content ?? []) content.push(...fill(structuredClone(block), row))
  })
  return { ...doc, content: content.length ? content : [{ type: 'paragraph' }] }
}
