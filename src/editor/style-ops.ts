import type { Editor } from '@tiptap/core'
import type { ParaProps, RunProps, StyleDef, StyleMap } from './model'

// Named-style editing. Styles live in the doc attribute `styles`, so every change is undoable
// and every paragraph using a style restyles at once.

const stylesOf = (e: Editor): StyleMap => (e.state.doc.attrs.styles as StyleMap | null) ?? {}

export function saveStyle(editor: Editor, def: StyleDef) {
  editor.view.dispatch(editor.state.tr.setDocAttribute('styles', { ...stylesOf(editor), [def.id]: def }))
}

export function uniqueStyleId(styles: StyleMap, name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, '') || 'Style'
  let id = base
  for (let n = 2; styles[id]; n++) id = `${base}${n}`
  return id
}

const PARA_KEYS = ['align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indentLeft', 'indentRight', 'indentFirst', 'keepNext', 'keepLines'] as const

/** Fold the current paragraph's direct formatting (and the formatting at the caret) into its style. */
export function updateStyleFromSelection(editor: Editor): string | null {
  const { $from } = editor.state.selection
  const para = $from.parent
  if (para.type.name !== 'paragraph' && para.type.name !== 'heading') return null
  const id = (para.attrs.styleId as string) ?? (para.type.name === 'heading' ? `Heading${para.attrs.level}` : 'Normal')
  const styles = stylesOf(editor)
  const cur = styles[id] ?? { id, name: id, type: 'paragraph' as const, basedOn: 'Normal' }
  const p: ParaProps = { ...cur.para }
  for (const k of PARA_KEYS) if (para.attrs[k] != null && para.attrs[k] !== false) (p as Record<string, unknown>)[k] = para.attrs[k]
  const r: RunProps = { ...cur.run }
  const marks = (para.firstChild?.marks ?? $from.marks()).concat()
  const ts = marks.find((m) => m.type.name === 'textStyle')?.attrs ?? {}
  if (ts.fontFamily) r.fontFamily = String(ts.fontFamily).split(',')[0].replace(/["']/g, '').trim()
  if (ts.fontSize) r.fontSize = parseFloat(String(ts.fontSize))
  if (ts.color) r.color = String(ts.color)
  if (marks.some((m) => m.type.name === 'bold')) r.bold = true
  if (marks.some((m) => m.type.name === 'italic')) r.italic = true
  if (marks.some((m) => m.type.name === 'underline')) r.underline = true
  const tr = editor.state.tr.setDocAttribute('styles', { ...styles, [id]: { ...cur, para: p, run: r } })
  // The paragraph now gets everything from its style.
  const pos = $from.before()
  const cleared: Record<string, unknown> = { ...para.attrs }
  for (const k of PARA_KEYS) cleared[k] = k === 'keepNext' || k === 'keepLines' ? false : null
  tr.setNodeMarkup(pos, undefined, cleared)
  tr.removeMark(pos + 1, pos + para.nodeSize - 1, editor.schema.marks.textStyle)
  for (const name of ['bold', 'italic', 'underline']) if (r[name as 'bold']) tr.removeMark(pos + 1, pos + para.nodeSize - 1, editor.schema.marks[name])
  editor.view.dispatch(tr)
  return id
}
