import { useEffect, useMemo, useState } from 'react'
import { Editor, type JSONContent } from '@tiptap/core'
import { EditorContent, useEditorState } from '@tiptap/react'
import { Trash2, X } from 'lucide-react'
import { createExtensions } from '@/editor/extensions'
import { notesKey } from '@/editor/notes'
import { notesAreaHtml, notesForPage } from '@/editor/notes-render'
import { paginationKey } from '@/layout/plugin'
import { ptToPx, type PageSetup } from '@/editor/model'
import { set, hfEditor, useApp } from '../state/store'
import { Btn } from '../ui'

/** Footnotes (and endnotes on the last page) at the bottom of one page sheet. Click a note to edit it. */
export function StaticNotes({ body, tabId, page, index }: { body: Editor; tabId: string; page: PageSetup; index: number }) {
  const html = useEditorState({
    editor: body,
    selector: ({ editor: e }) => {
      const notes = notesKey.getState(e.state)?.notes ?? []
      if (!notes.length) return ''
      return notesAreaHtml(notesForPage(notes, paginationKey.getState(e.state)?.breaks ?? [], index))
    }
  })
  if (!html) return null
  const m = page.margins
  return (
    <div
      className="sd-doc sd-notes z-[2]"
      style={{ left: ptToPx(m.left), width: ptToPx(page.width - m.left - m.right), bottom: ptToPx(m.bottom) }}
      onMouseDown={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-note-pos]')
        if (!el) return
        e.preventDefault()
        e.stopPropagation()
        set({ note: { tabId, pos: Number(el.dataset.notePos) } })
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Floating editor for one footnote/endnote; edits are written back into the reference node. */
export function NoteEditor({ body, pos }: { body: Editor; pos: number }) {
  const node = body.state.doc.nodeAt(pos)
  const [coords] = useState(() => {
    try {
      return body.view.coordsAtPos(pos)
    } catch {
      return { left: 200, bottom: 200, top: 180, right: 200 }
    }
  })
  const editor = useMemo(() => {
    const content = (node?.attrs.content as JSONContent[] | undefined)?.length ? (node!.attrs.content as JSONContent[]) : [{ type: 'paragraph' }]
    return new Editor({
      extensions: createExtensions({ placeholder: 'Note text' }),
      content: { type: 'doc', attrs: { styles: body.state.doc.attrs.styles }, content },
      editorProps: { attributes: { class: 'sd-doc sd-note-edit', 'aria-label': 'Note text' } }
    })
  }, [body, pos])

  useEffect(() => {
    hfEditor.current = editor
    useApp.setState((s) => ({ note: s.note ? { ...s.note } : null }))
    const commit = () => {
      const n = body.state.doc.nodeAt(pos)
      if (n?.type.name !== 'footnote') return
      body.view.dispatch(body.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, content: editor.getJSON().content ?? [] }))
    }
    editor.on('update', commit)
    // Tiptap's focus() moves DOM focus a frame later; keys typed right after opening must land here, not in the body.
    editor.commands.focus('end')
    editor.view.focus()
    return () => {
      editor.off('update', commit)
      if (hfEditor.current === editor) hfEditor.current = null
      editor.destroy()
    }
  }, [editor, body, pos])

  if (node?.type.name !== 'footnote') return null
  const close = () => {
    set({ note: null })
    body.commands.focus()
  }
  const remove = () => {
    body.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run()
    set({ note: null })
  }
  const top = Math.min(coords.bottom + 10, window.innerHeight - 220)
  const left = Math.min(Math.max(16, coords.left - 40), window.innerWidth - 400)
  return (
    <div className="fixed inset-0 z-[70]" onMouseDown={close}>
      <div
        className="pop-in absolute w-[380px] rounded-xl border border-border bg-elev p-3 shadow-[var(--shadow-pop)]"
        style={{ top, left }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        role="dialog"
        aria-label={node.attrs.kind === 'endnote' ? 'Edit endnote' : 'Edit footnote'}
        data-testid="note-editor"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-text-2">{node.attrs.kind === 'endnote' ? 'Endnote' : 'Footnote'}</span>
          <div className="flex gap-1">
            <button onClick={remove} className="flex size-6 items-center justify-center rounded text-text-3 hover:bg-hover hover:text-danger" aria-label="Delete note">
              <Trash2 className="size-3.5" />
            </button>
            <button onClick={close} className="flex size-6 items-center justify-center rounded text-text-3 hover:bg-hover hover:text-text" aria-label="Close">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border bg-white px-3 py-2 text-black">
          <EditorContent editor={editor} />
        </div>
        <div className="mt-2 flex justify-end">
          <Btn size="sm" variant="primary" onClick={close}>
            Done
          </Btn>
        </div>
      </div>
    </div>
  )
}
