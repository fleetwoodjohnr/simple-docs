import { mergeDocuments, parseCsv, setMergePreview } from '@/editor/mailmerge'
import { editors, get, set, toast } from './store'
import * as docs from './documents'

// Mail-merge actions for the active document. The data source lives in memory with the tab.

export async function selectRecipients(id = get().active) {
  const [f] = await window.simpleDocs.openDialog({ name: 'Recipient list (CSV)', extensions: ['csv', 'tsv', 'txt'] })
  if (!f) return
  const { fields, rows } = parseCsv(new TextDecoder().decode(f.data))
  if (!fields.length || !rows.length) return toast(`${f.name} has no rows under a header line`, 'error')
  set((s) => ({ merge: { ...s.merge, [id]: { data: { name: f.name, fields, rows }, preview: null } } }))
  toast(`${rows.length} recipient${rows.length === 1 ? '' : 's'} with fields ${fields.join(', ')}`, 'success')
}

export function previewRecord(index: number | null, id = get().active) {
  const m = get().merge[id]
  const editor = editors.get(id)
  if (!m || !editor) return
  const i = index === null ? null : Math.max(0, Math.min(m.data.rows.length - 1, index))
  setMergePreview(editor, i === null ? null : m.data.rows[i])
  set((s) => ({ merge: { ...s.merge, [id]: { ...m, preview: i } } }))
}

export function finishMerge(id = get().active) {
  const m = get().merge[id]
  const editor = editors.get(id)
  const tab = get().tabs.find((t) => t.id === id)
  if (!m || !editor || !tab) return
  docs.newDocument(mergeDocuments(editor.getJSON(), m.data.rows), `${tab.title} (merged)`)
  toast(`Merged ${m.data.rows.length} copies into a new document`, 'success')
}
