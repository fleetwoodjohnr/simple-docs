import { useState, type PointerEvent as RPointerEvent } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { pageOf } from '@/layout/plugin'
import { ptToPx, type PageSetup } from '@/editor/model'
import { updateBlocks } from './commands'

type Handle = 'marginLeft' | 'marginRight' | 'indentLeft' | 'indentFirst' | 'indentRight'
const SNAP = 4.5 // 1/16 inch in points

/** Horizontal ruler: shows margins and paragraph indents; drag handles to change them. */
export function Ruler({ editor, zoom }: { editor: Editor; zoom: number }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const p = e.state.selection.$from.parent
      const para = p.type.name === 'paragraph' || p.type.name === 'heading'
      return {
        page: pageOf(e.state.doc),
        left: para ? ((p.attrs.indentLeft as number) ?? 0) : 0,
        first: para ? ((p.attrs.indentFirst as number) ?? 0) : 0,
        right: para ? ((p.attrs.indentRight as number) ?? 0) : 0
      }
    }
  })
  const [drag, setDrag] = useState<{ h: Handle; value: number } | null>(null)
  if (!s) return null
  const { page } = s
  const k = (pt: number) => ptToPx(pt) * zoom
  const width = k(page.width)
  const m = page.margins
  const val = (h: Handle) => (drag?.h === h ? drag.value : h === 'marginLeft' ? m.left : h === 'marginRight' ? m.right : h === 'indentLeft' ? s.left : h === 'indentFirst' ? s.first : s.right)
  const ml = val('marginLeft')
  const mr = val('marginRight')

  const start = (h: Handle) => (e: RPointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const v0 = val(h)
    let v = v0
    const move = (ev: PointerEvent) => {
      const dPt = (ev.clientX - x0) / (ptToPx(1) * zoom)
      const dir = h === 'marginRight' || h === 'indentRight' ? -1 : 1
      v = Math.round((v0 + dir * dPt) / SNAP) * SNAP
      if (h !== 'indentFirst') v = Math.max(0, v)
      setDrag({ h, value: v })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDrag(null)
      if (v === v0) return
      if (h === 'marginLeft' || h === 'marginRight') {
        const next: PageSetup = { ...page, margins: { ...m, [h === 'marginLeft' ? 'left' : 'right']: v } }
        if (page.width - next.margins.left - next.margins.right < 72) return
        editor.chain().command(({ tr }) => (tr.setDocAttribute('page', next), true)).run()
      } else updateBlocks(editor, { [h]: v || null })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const ticks: React.ReactElement[] = []
  const inch = 72
  for (let pt = 0, i = 0; pt <= page.width; pt += inch / 8, i++) {
    const x = k(pt)
    const major = i % 8 === 0
    const half = i % 4 === 0
    ticks.push(<span key={i} className="absolute bottom-0 w-px bg-text-3/60" style={{ left: x, height: major ? 0 : half ? 6 : 3 }} />)
  }
  // Inch numbers relative to the left margin (like most word processors).
  const labels: React.ReactElement[] = []
  for (let n = -Math.floor(ml / inch); ml + n * inch <= page.width; n++) {
    if (n === 0) continue
    labels.push(
      <span key={n} className="absolute top-[2px] -translate-x-1/2 text-[9px] tabular-nums text-text-3" style={{ left: k(ml + n * inch) }}>
        {Math.abs(n)}
      </span>
    )
  }

  const marker = (h: Handle, x: number, shape: 'down' | 'up' | 'box', title: string) => (
    <span
      role="slider"
      aria-label={title}
      aria-valuenow={Math.round(val(h))}
      title={title}
      onPointerDown={start(h)}
      className="absolute z-10 -translate-x-1/2 cursor-ew-resize touch-none text-accent"
      style={{ left: x, top: shape === 'down' ? 0 : shape === 'box' ? 15 : 9 }}
    >
      {shape === 'box' ? <span className="block h-[5px] w-[9px] rounded-[1px] bg-current" /> : <svg width="10" height="7" viewBox="0 0 10 7">{shape === 'down' ? <path d="M0 0h10L5 7z" fill="currentColor" /> : <path d="M0 7h10L5 0z" fill="currentColor" />}</svg>}
    </span>
  )

  const textLeft = k(ml)
  const textRight = width - k(mr)
  return (
    <div className="sticky top-0 z-20 flex justify-center border-b border-border bg-bg/85 py-1 backdrop-blur" data-testid="ruler">
      <div className="relative h-5 select-none overflow-visible rounded-[3px] bg-border" style={{ width }}>
        <div className="absolute inset-y-0 bg-panel" style={{ left: textLeft, width: Math.max(0, textRight - textLeft) }} />
        {ticks}
        {labels}
        <span title="Left margin" onPointerDown={start('marginLeft')} className="absolute inset-y-0 z-[5] w-2 -translate-x-1/2 cursor-col-resize touch-none" style={{ left: textLeft }} />
        <span title="Right margin" onPointerDown={start('marginRight')} className="absolute inset-y-0 z-[5] w-2 -translate-x-1/2 cursor-col-resize touch-none" style={{ left: textRight }} />
        {marker('indentFirst', textLeft + k(val('indentLeft') + val('indentFirst')), 'down', 'First line indent')}
        {marker('indentLeft', textLeft + k(val('indentLeft')), 'up', 'Left indent')}
        {marker('indentRight', textRight - k(val('indentRight')), 'up', 'Right indent')}
        {drag && <span className="pointer-events-none absolute top-full z-30 h-[100vh] w-px bg-accent/70" style={{ left: drag.h === 'marginRight' ? width - k(drag.value) : drag.h === 'indentRight' ? textRight - k(drag.value) : drag.h === 'marginLeft' ? k(drag.value) : drag.h === 'indentFirst' ? textLeft + k(val('indentLeft') + drag.value) : textLeft + k(drag.value) }} />}
      </div>
    </div>
  )
}
