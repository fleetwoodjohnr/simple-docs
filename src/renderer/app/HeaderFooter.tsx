import { useEffect, useMemo, useRef } from 'react'
import { Editor, type JSONContent } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { Hash, X, CalendarDays, Type } from 'lucide-react'
import { createExtensions } from '@/editor/extensions'
import { hfOf, renderHF } from '@/editor/headers'
import { hfVariantFor, ptToPx, type HeadersFooters, type HFKind, type PageSetup } from '@/editor/model'
import { PAGE_GAP } from '@/layout/plugin'
import { set, hfEditor, useApp } from '../state/store'
import { cx } from '../ui'

export function setHF(body: Editor, next: HeadersFooters) {
  body.chain().command(({ tr }) => (tr.setDocAttribute('hf', next), true)).run()
}

/** Read-only header and footer for one page sheet. */
export function StaticHF({ body, page, index, count, hidden }: { body: Editor; page: PageSetup; index: number; count: number; hidden?: HFKind | null }) {
  const doc = body.state.doc
  const m = page.margins
  const style = { left: ptToPx(m.left), width: ptToPx(page.width - m.left - m.right) }
  const header = hidden === 'header' ? '' : renderHF(doc, 'header', index, count)
  const footer = hidden === 'footer' ? '' : renderHF(doc, 'footer', index, count)
  return (
    <>
      {header && <div className="sd-doc sd-hf" style={{ ...style, top: ptToPx(m.header) }} dangerouslySetInnerHTML={{ __html: header }} />}
      {footer && <div className="sd-doc sd-hf" style={{ ...style, bottom: ptToPx(m.footer) }} dangerouslySetInnerHTML={{ __html: footer }} />}
    </>
  )
}

/** Which header/footer zone a point (in unscaled stack coordinates) falls in. */
export function hfZoneAt(page: PageSetup, y: number): { page: number; kind: HFKind } | null {
  const h = ptToPx(page.height)
  const i = Math.floor(y / (h + PAGE_GAP))
  const within = y - i * (h + PAGE_GAP)
  if (within < 0 || within > h) return null
  if (within < ptToPx(page.margins.top)) return { page: i, kind: 'header' }
  if (within > h - ptToPx(page.margins.bottom)) return { page: i, kind: 'footer' }
  return null
}

/** In-place editor for one page's header or footer. Edits write back into the body document's `hf` attribute. */
export function HFEditor({ body, page, kind, index }: { body: Editor; page: PageSetup; kind: HFKind; index: number }) {
  const hf = hfOf(body.state.doc)
  const variant = hfVariantFor(hf, index)
  const m = page.margins
  const h = ptToPx(page.height)
  const latest = useRef(hf)
  latest.current = hf

  const editor = useMemo(() => {
    const content = (hf[kind][variant] as JSONContent[] | undefined)?.length ? (hf[kind][variant] as JSONContent[]) : [{ type: 'paragraph' }]
    return new Editor({
      extensions: createExtensions({ placeholder: kind === 'header' ? 'Header' : 'Footer' }),
      content: { type: 'doc', attrs: { styles: body.state.doc.attrs.styles }, content },
      editorProps: { attributes: { class: 'sd-doc sd-hf-edit', 'aria-label': kind === 'header' ? 'Header' : 'Footer' } }
    })
  }, [body, kind, variant])

  useEffect(() => {
    hfEditor.current = editor
    // New object identity so the ribbon re-renders against the header editor.
    useApp.setState((s) => ({ hf: s.hf ? { ...s.hf } : null }))
    const commit = () => {
      const cur = latest.current
      const json = editor.getJSON().content ?? []
      const empty = json.length === 1 && json[0].type === 'paragraph' && !json[0].content
      setHF(body, { ...cur, [kind]: { ...cur[kind], [variant]: empty ? null : json } })
    }
    editor.on('update', commit)
    requestAnimationFrame(() => editor.commands.focus('end'))
    return () => {
      editor.off('update', commit)
      if (hfEditor.current === editor) hfEditor.current = null
      editor.destroy()
    }
  }, [editor, body, kind, variant])

  const close = () => set({ hf: null })
  const toggle = (k: 'differentFirst' | 'differentOddEven') => setHF(body, { ...latest.current, [k]: !latest.current[k] })
  const insertField = (k: string) => editor.chain().focus().insertContent({ type: 'field', attrs: { kind: k } }).run()
  const top = index * (h + PAGE_GAP)
  const label = `${variant === 'first' ? 'First page ' : variant === 'even' ? 'Even page ' : ''}${kind === 'header' ? 'Header' : 'Footer'}`
  const chip = 'flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-text-2 hover:bg-hover hover:text-text'

  return (
    <div
      className="absolute z-[3]"
      style={{ top: top + (kind === 'header' ? 0 : h - ptToPx(m.bottom)), left: 0, width: ptToPx(page.width), height: ptToPx(kind === 'header' ? m.top : m.bottom) }}
      onKeyDown={(e) => e.key === 'Escape' && close()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="pointer-events-none absolute inset-x-0 border-dashed border-accent/60" style={kind === 'header' ? { bottom: 0, borderBottomWidth: 1 } : { top: 0, borderTopWidth: 1 }} />
      <div
        className={cx('pop-in absolute z-[4] flex items-center gap-0.5 rounded-lg border border-border bg-elev px-1 py-0.5 shadow-[var(--shadow-pop)]', kind === 'header' ? 'bottom-[-34px]' : 'top-[-34px]')}
        style={{ left: ptToPx(m.left) }}
        data-testid="hf-toolbar"
      >
        <span className="px-1.5 text-[11px] font-semibold text-accent">{label}</span>
        <button className={chip} onClick={() => insertField('page')}>
          <Hash className="size-3" /> Page
        </button>
        <button className={chip} onClick={() => insertField('pages')}>
          <Hash className="size-3" /> Pages
        </button>
        <button className={chip} onClick={() => insertField('date')}>
          <CalendarDays className="size-3" /> Date
        </button>
        <button className={chip} onClick={() => insertField('title')}>
          <Type className="size-3" /> Title
        </button>
        <label className={cx(chip, 'cursor-pointer')}>
          <input type="checkbox" className="accent-[var(--accent)]" checked={hf.differentFirst} onChange={() => toggle('differentFirst')} /> Different first page
        </label>
        <label className={cx(chip, 'cursor-pointer')}>
          <input type="checkbox" className="accent-[var(--accent)]" checked={hf.differentOddEven} onChange={() => toggle('differentOddEven')} /> Odd &amp; even
        </label>
        <button className={chip} onClick={close} aria-label="Close header and footer">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="absolute" style={{ left: ptToPx(m.left), width: ptToPx(page.width - m.left - m.right), ...(kind === 'header' ? { top: ptToPx(m.header) } : { bottom: ptToPx(m.footer) }) }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
