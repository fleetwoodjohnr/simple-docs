import { mergeDocuments, parseCsv, setMergePreview, type MergeData } from '@/editor/mailmerge'
import { editors, get, set, toast } from './store'
import * as docs from './documents'

// Mail-merge actions for the active document. The recipient list is the doc attribute `mergeData`,
// so it is saved with the document (DOCX), undoable and recovered like any other content.

export const recipientsOf = (id = get().active): MergeData | null => (editors.get(id)?.state.doc.attrs.mergeData as MergeData | null) ?? null

function setRecipients(id: string, data: MergeData | null) {
  const editor = editors.get(id)
  if (!editor) return
  previewRecord(null, id)
  editor.view.dispatch(editor.state.tr.setDocAttribute('mergeData', data))
}

export async function selectRecipients(id = get().active) {
  const [f] = await window.simpleDocs.openDialog({ name: 'Recipient list (CSV)', extensions: ['csv', 'tsv', 'txt'] })
  if (!f) return
  const { fields, rows } = parseCsv(new TextDecoder().decode(f.data))
  if (!fields.length || !rows.length) return toast(`${f.name} has no rows under a header line`, 'error')
  setRecipients(id, { name: f.name, fields, rows })
  toast(`${rows.length} recipient${rows.length === 1 ? '' : 's'} with fields ${fields.join(', ')}. The list is saved with this document.`, 'success')
}

export function removeRecipients(id = get().active) {
  setRecipients(id, null)
  toast('Recipient list removed from this document', 'success')
}

export function previewRecord(index: number | null, id = get().active) {
  const data = recipientsOf(id)
  const editor = editors.get(id)
  if (!editor) return
  const i = index === null || !data ? null : Math.max(0, Math.min(data.rows.length - 1, index))
  setMergePreview(editor, i === null ? null : data!.rows[i])
  set((s) => ({ merge: { ...s.merge, [id]: { preview: i } } }))
}

export function finishMerge(id = get().active) {
  const data = recipientsOf(id)
  const editor = editors.get(id)
  const tab = get().tabs.find((t) => t.id === id)
  if (!data || !editor || !tab) return
  docs.newDocument(mergeDocuments(editor.getJSON(), data.rows), `${tab.title} (merged)`)
  toast(`Merged ${data.rows.length} copies into a new document`, 'success')
}
