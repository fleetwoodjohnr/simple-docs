import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { EditorContent, useEditorState, type Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { PAGE_GAP, pageOf, paginationKey } from '@/layout/plugin'
import { ptToPx, type StyleMap } from '@/editor/model'
import { stylesToCss } from '@/editor/styles-css'

export function usePageCount(editor: Editor): number {
  return useEditorState({ editor, selector: ({ editor: e }) => paginationKey.getState(e.state)?.pageCount ?? 1 }) ?? 1
}

/** Scope class shared by the live editor and print clones so document styles apply to both. */
export const docScope = (tabId: string) => `doc-${tabId}`

interface Props {
  tabId: string
  editor: Editor
  zoom: number
  showMarks: boolean
  showBoundaries: boolean
  onZoomChange?: (z: number) => void
}

export function DocumentView({ tabId, editor, zoom, showMarks, showBoundaries, onZoomChange }: Props) {
  const pageCount = usePageCount(editor)
  const { page, styles } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ page: pageOf(e.state.doc), styles: e.state.doc.attrs.styles as StyleMap | null })
  })
  const css = useMemo(() => (styles ? stylesToCss(styles, `.${docScope(tabId)} .sd-doc`) : ''), [styles, tabId])
  const w = ptToPx(page.width)
  const h = ptToPx(page.height)
  const m = page.margins
  const stackH = pageCount * (h + PAGE_GAP) - PAGE_GAP
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ctrl/Cmd + wheel zoom
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !onZoomChange) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      onZoomChange(Math.round(Math.min(5, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) * 100) / 100)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, onZoomChange])

  // Root sizing follows page setup.
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    dom.style.width = `${w}px`
    dom.style.padding = `${ptToPx(m.top)}px ${ptToPx(m.right)}px 0 ${ptToPx(m.left)}px`
    dom.style.minHeight = `${h}px`
  }, [editor, w, h, m.top, m.right, m.left])

  /** Clicking on paper outside the text area places the caret at the nearest position. */
  const onSheetMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sd-doc')) return
    const view = editor.view
    const rect = (view.dom as HTMLElement).getBoundingClientRect()
    const scale = rect.width / (view.dom as HTMLElement).offsetWidth
    const left = Math.min(Math.max(e.clientX, rect.left + ptToPx(m.left) * scale + 2), rect.right - ptToPx(m.right) * scale - 2)
    const hit = view.posAtCoords({ left, top: e.clientY })
    e.preventDefault()
    const pos = hit?.pos ?? view.state.doc.content.size
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
    view.focus()
  }

  const stackStyle: CSSProperties = { width: w, height: stackH, transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative' }

  return (
    <div ref={scrollRef} className={`h-full overflow-auto bg-workspace ${showMarks ? 'show-marks' : ''}`} data-doc-scroll={tabId}>
      <style>{css}</style>
      <div className="mx-auto py-8" style={{ width: Math.max(w * zoom, 1) + 120 }}>
        <div className="relative mx-auto" style={{ width: w * zoom, height: stackH * zoom }}>
          <div className={docScope(tabId)} style={stackStyle} onMouseDown={onSheetMouseDown} data-page-stack>
            {Array.from({ length: pageCount }, (_, i) => (
              <div
                key={i}
                className="page-sheet"
                data-page={i + 1}
                style={{ top: i * (h + PAGE_GAP), width: w, height: h, background: page.background ?? '#fff' }}
              >
                {showBoundaries && <Marks m={m} />}
                {zoom >= 0.6 && <span className="page-num select-none">{i + 1}</span>}
              </div>
            ))}
            <div className="doc-host" style={{ width: w }}>
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Marks({ m }: { m: { top: number; right: number; bottom: number; left: number } }) {
  const t = ptToPx(m.top) - 14
  const l = ptToPx(m.left) - 14
  const r = ptToPx(m.right) - 14
  const b = ptToPx(m.bottom) - 14
  return (
    <>
      <span className="margin-mark" style={{ top: t, left: l, borderRight: '1px solid', borderBottom: '1px solid' }} />
      <span className="margin-mark" style={{ top: t, right: r, borderLeft: '1px solid', borderBottom: '1px solid' }} />
      <span className="margin-mark" style={{ bottom: b, left: l, borderRight: '1px solid', borderTop: '1px solid' }} />
      <span className="margin-mark" style={{ bottom: b, right: r, borderLeft: '1px solid', borderTop: '1px solid' }} />
    </>
  )
}
