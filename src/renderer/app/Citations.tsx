import { useState } from 'react'
import { useEditorState } from '@tiptap/react'
import { BookMarked, Pencil, Plus, Quote, Trash2 } from 'lucide-react'
import { deleteSource, formatEntry, insertCitation, saveSource, sourcesOf, styleOf, type Source, type SourceType } from '@/editor/citations'
import { bodyEditor, set } from '../state/store'
import { Btn, Field, IconBtn, Modal, Segmented, cx, inputCls } from '../ui'
import { Empty } from './Panels'

const close = () => set({ dialog: null })

const TYPE_LABELS: Record<SourceType, string> = { book: 'Book', article: 'Journal article', website: 'Website', report: 'Report' }
const CONTAINER_LABEL: Record<SourceType, string | null> = { book: null, report: null, article: 'Journal', website: 'Website name' }

const EMPTY: Source = { type: 'book', authors: [], title: '' }

function SourceForm({ initial, onSave, onCancel }: { initial: Source; onSave: (s: Source) => void; onCancel: () => void }) {
  const [s, setS] = useState<Source>(initial)
  const [authors, setAuthors] = useState(initial.authors.join('\n'))
  const field = (k: keyof Source, label: string, placeholder = '') => (
    <Field label={label}>
      <input className={inputCls} value={(s[k] as string | undefined) ?? ''} placeholder={placeholder} onChange={(e) => setS({ ...s, [k]: e.target.value || undefined })} />
    </Field>
  )
  const save = () => onSave({ ...s, authors: authors.split('\n').map((a) => a.trim()).filter(Boolean), title: s.title.trim() })
  return (
    <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), s.title.trim() && save())}>
      <Segmented label="Source type" value={s.type} onChange={(type) => setS({ ...s, type })} options={(Object.keys(TYPE_LABELS) as SourceType[]).map((v) => ({ value: v, label: TYPE_LABELS[v] }))} />
      <Field label="Authors" hint="One per line, as “Last, First”. An organization: just its name.">
        <textarea className={cx(inputCls, 'h-16 py-1.5')} value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder={'Lovelace, Ada\nBabbage, Charles'} />
      </Field>
      {field('title', 'Title')}
      <div className="grid grid-cols-2 gap-3">
        {field('year', 'Year')}
        {CONTAINER_LABEL[s.type] ? field('container', CONTAINER_LABEL[s.type]!) : field('publisher', 'Publisher')}
      </div>
      {s.type === 'article' && (
        <div className="grid grid-cols-3 gap-3">
          {field('volume', 'Volume')}
          {field('issue', 'Issue')}
          {field('pages', 'Pages', '12–34')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {field('url', 'URL', 'https://')}
        {field('doi', 'DOI', '10.1000/xyz')}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Btn type="button" onClick={onCancel}>
          Cancel
        </Btn>
        <Btn type="submit" variant="primary" disabled={!s.title.trim()} data-testid="save-source">
          Save source
        </Btn>
      </div>
    </form>
  )
}

export function SourcesDialog({ insert }: { insert: boolean }) {
  const editor = bodyEditor()
  const { sources, style } = useEditorState({ editor: editor!, selector: ({ editor: e }) => ({ sources: sourcesOf(e.state.doc), style: styleOf(e.state.doc) }) })
  const [editing, setEditing] = useState<{ id?: string; source: Source } | null>(Object.keys(sources).length ? null : { source: EMPTY })
  const [pages, setPages] = useState('')
  if (!editor) return null
  const cite = (id: string) => {
    close()
    insertCitation(editor, id, pages.trim() || undefined)
  }
  const entries = Object.entries(sources)
  return (
    <Modal open onOpenChange={(o) => !o && close()} title={editing ? (editing.id ? 'Edit source' : 'New source') : insert ? 'Insert citation' : 'Sources'} width={560}>
      {editing ? (
        <SourceForm
          initial={editing.source}
          onCancel={() => (entries.length ? setEditing(null) : close())}
          onSave={(s) => {
            const id = saveSource(editor, s, editing.id)
            if (insert && !editing.id) cite(id)
            else setEditing(null)
          }}
        />
      ) : (
        <div className="space-y-3">
          {insert && (
            <Field label="Page or range (optional)">
              <input className={cx(inputCls, 'w-40')} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="12" />
            </Field>
          )}
          {entries.length ? (
            <ul className="max-h-[340px] space-y-1.5 overflow-y-auto" data-testid="source-list">
              {entries.map(([id, s]) => (
                <li key={id} className="group flex items-start gap-2 rounded-lg border border-border p-2.5">
                  <BookMarked className="mt-0.5 size-4 shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
                    {formatEntry(s, style).map((n, k) => (n.marks ? <i key={k}>{n.text}</i> : <span key={k}>{n.text}</span>))}
                  </div>
                  {insert ? (
                    <Btn size="sm" variant="primary" onClick={() => cite(id)}>
                      Cite
                    </Btn>
                  ) : (
                    <>
                      <IconBtn label="Edit source" size="sm" onClick={() => setEditing({ id, source: s })}>
                        <Pencil className="size-3.5" />
                      </IconBtn>
                      <IconBtn label="Delete source" size="sm" onClick={() => deleteSource(editor, id)}>
                        <Trash2 className="size-3.5" />
                      </IconBtn>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<Quote className="size-5" />} title="No sources yet">
              Add the books, articles and websites you cite. They are stored in this document.
            </Empty>
          )}
          <Btn onClick={() => setEditing({ source: EMPTY })}>
            <Plus className="size-3.5" /> New source…
          </Btn>
        </div>
      )}
    </Modal>
  )
}

export const openSources = (insert: boolean) => set({ dialog: { kind: 'sources', insert } })
