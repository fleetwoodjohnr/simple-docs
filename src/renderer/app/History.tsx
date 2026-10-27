import { useEffect, useState } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { History as HistoryIcon } from 'lucide-react'
import { editors, get, set, toast } from '../state/store'
import * as docs from '../state/documents'
import { Btn, Modal, cx } from '../ui'
import { Empty } from './Panels'

const close = () => set({ dialog: null })

/** Replace the whole document (content and document attributes) in one undoable step. */
export function replaceDocument(editor: Editor, json: JSONContent) {
  const next = editor.schema.nodeFromJSON(json)
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content)
  for (const [k, v] of Object.entries(next.attrs)) tr.setDocAttribute(k, v)
  editor.view.dispatch(tr)
}

const plain = (json: JSONContent): string =>
  json.text ?? (json.content ?? []).map(plain).join(json.type === 'paragraph' || json.type === 'heading' ? '' : '\n').replace(/\n{3,}/g, '\n\n')

export function HistoryDialog() {
  const tab = get().tabs.find((t) => t.id === get().active)
  const editor = editors.get(get().active)
  const [versions, setVersions] = useState<{ id: string; savedAt: number; bytes: number }[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<JSONContent | null>(null)
  useEffect(() => {
    if (tab?.path) void window.simpleDocs.historyList(tab.path).then((v) => (setVersions(v), setSelected(v[0]?.id ?? null)))
    else setVersions([])
  }, [tab?.path])
  useEffect(() => {
    setPreview(null)
    if (tab?.path && selected) void window.simpleDocs.historyRead(tab.path, selected).then((s) => setPreview(JSON.parse(s)))
  }, [tab?.path, selected])
  if (!tab || !editor) return null
  const text = preview ? plain(preview).trim() : ''
  const words = text.split(/\s+/).filter(Boolean).length
  const stamp = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Version history"
      description="A version is kept every time you save (and every 10 minutes while AutoSave is on). Versions stay on this computer."
      width={760}
      footer={
        <>
          <Btn
            className="mr-auto"
            disabled={!preview}
            onClick={() => {
              close()
              docs.newDocument(preview!, `${tab.title} (${stamp(Number(selected))})`)
            }}
          >
            Open as copy
          </Btn>
          <Btn
            disabled={!preview}
            onClick={() => {
              close()
              docs.compareWith(preview!, `${tab.title} (${stamp(Number(selected))})`)
            }}
          >
            Compare with current
          </Btn>
          <Btn onClick={close}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!preview}
            data-testid="restore-version"
            onClick={() => {
              replaceDocument(editor, preview!)
              close()
              toast('Version restored. Undo (Ctrl+Z) brings back the current text.', 'success')
            }}
          >
            Restore this version
          </Btn>
        </>
      }
    >
      {versions && !versions.length ? (
        <Empty icon={<HistoryIcon className="size-5" />} title="No versions yet">
          {tab.path ? 'Versions appear here after you save.' : 'Save the document to start keeping versions.'}
        </Empty>
      ) : (
        <div className="flex h-[380px] gap-3">
          <ul className="w-[220px] shrink-0 space-y-1 overflow-y-auto" role="listbox" aria-label="Versions">
            {(versions ?? []).map((v, i) => (
              <li key={v.id}>
                <button
                  role="option"
                  aria-selected={selected === v.id}
                  onClick={() => setSelected(v.id)}
                  className={cx('w-full rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-hover', selected === v.id && 'bg-accent-soft text-accent hover:bg-accent-soft')}
                >
                  <div className="font-medium">{stamp(v.savedAt)}</div>
                  <div className="text-[11px] text-text-3">{i === 0 ? 'Latest save' : `${Math.max(1, Math.round(v.bytes / 1024))} KB`}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-panel-2 p-4" data-testid="version-preview">
            {preview && <div className="mb-2 text-[11.5px] text-text-3">{words.toLocaleString()} words</div>}
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{text.slice(0, 4000) || (preview ? 'Empty document' : '')}</div>
          </div>
        </div>
      )}
    </Modal>
  )
}
