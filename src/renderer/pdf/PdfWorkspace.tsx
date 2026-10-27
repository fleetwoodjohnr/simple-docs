import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import {
  ArrowUp, Crop, Eraser, FilePlus2, Files, Highlighter, ImagePlus, Loader2, MessageSquare, MousePointer2, PenLine, PenTool, RotateCcw, RotateCw, Save, Scissors, Search, SquareDashed,
  ScanText, Strikethrough, TextCursorInput, Trash2, Type, TypeOutline, Underline, Undo2, ZoomIn, ZoomOut, X, Info, FormInput, Signature, ChevronUp, ChevronDown
} from 'lucide-react'
import type { AnnotInfo, FieldInfo, TextRun } from '@/pdf/engine'
import { pdf, renderPng } from './client'
import { pdfSessions, toast, useApp } from '../state/store'
import * as docs from '../state/documents'
import { Btn, IconBtn, Modal, Tip, cx, inputCls } from '../ui'

type Tool = 'select' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'ink' | 'text' | 'edit' | 'field' | 'redact' | 'sign' | 'crop'
type Rect = [number, number, number, number] // left, top, right, bottom (PDF points)

const PX = 96 / 72

/** Map between PDF user space (unrotated, origin bottom-left) and page-local screen pixels. */
function mapper(info: { width: number; height: number; rotation: number }, s: number) {
  const r = ((info.rotation % 360) + 360) % 360
  const W0 = r % 180 ? info.height : info.width
  const H0 = r % 180 ? info.width : info.height
  const toScreen = (x: number, y: number): [number, number] =>
    r === 0 ? [x * s, (H0 - y) * s] : r === 90 ? [y * s, x * s] : r === 180 ? [(W0 - x) * s, y * s] : [(H0 - y) * s, (W0 - x) * s]
  const toPdf = (sx: number, sy: number): [number, number] =>
    r === 0 ? [sx / s, H0 - sy / s] : r === 90 ? [sy / s, sx / s] : r === 180 ? [W0 - sx / s, sy / s] : [W0 - sy / s, H0 - sx / s]
  const rectToScreen = (b: Rect) => {
    const [x1, y1] = toScreen(b[0], b[1])
    const [x2, y2] = toScreen(b[2], b[3])
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
  }
  const screenToRect = (a: [number, number], b: [number, number]): Rect => {
    const [x1, y1] = toPdf(a[0], a[1])
    const [x2, y2] = toPdf(b[0], b[1])
    return [Math.min(x1, x2), Math.max(y1, y2), Math.max(x1, x2), Math.min(y1, y2)]
  }
  return { toScreen, toPdf, rectToScreen, screenToRect, rotation: r }
}

const TOOLS: { id: Tool; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 />, hint: 'Select and copy text; fill form fields' },
  { id: 'highlight', label: 'Highlight', icon: <Highlighter />, hint: 'Select text to highlight it' },
  { id: 'underline', label: 'Underline', icon: <Underline />, hint: 'Select text to underline it' },
  { id: 'strikeout', label: 'Strike', icon: <Strikethrough />, hint: 'Select text to strike it through' },
  { id: 'note', label: 'Note', icon: <MessageSquare />, hint: 'Click to add a comment note' },
  { id: 'ink', label: 'Draw', icon: <PenTool />, hint: 'Draw freehand' },
  { id: 'text', label: 'Add text', icon: <Type />, hint: 'Click to add new text to the page' },
  { id: 'edit', label: 'Edit text', icon: <TypeOutline />, hint: 'Click a line of existing text to change it in the PDF (text does not reflow — keep edits about the same length)' },
  { id: 'field', label: 'Field', icon: <TextCursorInput />, hint: 'Drag to create a fillable text field (a small square makes a checkbox)' },
  { id: 'sign', label: 'Sign', icon: <Signature />, hint: 'Draw a signature or choose an image, then click to place it' },
  { id: 'redact', label: 'Redact', icon: <Eraser />, hint: 'Drag over content to remove it permanently' },
  { id: 'crop', label: 'Crop', icon: <Crop />, hint: 'Drag the area to keep on this page' }
]

export function PdfWorkspace({ tabId }: { tabId: string }) {
  const session = pdfSessions.get(tabId)!
  const author = useApp((s) => s.settings.authorName) || 'Author'
  const [doc, setDoc] = useState(session.doc)
  const [pages, setPages] = useState(session.pages)
  const [versions, setVersions] = useState<number[]>(() => session.pages.map(() => 0))
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [current, setCurrent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [redactions, setRedactions] = useState<Record<number, Rect[]>>({})
  const [annots, setAnnots] = useState<Record<number, AnnotInfo[]>>({})
  const [fields, setFields] = useState<Record<number, FieldInfo[]>>({})
  const [panel, setPanel] = useState<'comments' | 'forms' | 'info' | null>('comments')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ page: number; boxes: Rect[] }[]>([])
  const [hitIndex, setHitIndex] = useState(0)
  const [signature, setSignature] = useState<Uint8Array | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [confirmRedact, setConfirmRedact] = useState(false)
  const [ocrStatus, setOcrStatus] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const s = zoom * PX

  // Start at fit-width when the page is wider than the view (measured once the tab is first shown).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const avail = el.clientWidth - 48
      if (avail <= 0) return
      ro.disconnect()
      const widest = Math.max(...session.pages.map((p) => p.width)) * PX
      if (widest > avail) setZoom(Math.max(0.25, Math.floor((avail / widest) * 100) / 100))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const refreshPage = useCallback(
    async (i: number) => {
      const [a, f] = await Promise.all([pdf.annotations(doc, i), pdf.fields(doc, i)])
      setAnnots((x) => ({ ...x, [i]: a }))
      setFields((x) => ({ ...x, [i]: f }))
    },
    [doc]
  )

  useEffect(() => {
    pages.forEach((_, i) => void refreshPage(i))
  }, [doc, pages.length, refreshPage])

  /** Run a modification: snapshot for undo, apply, re-render affected pages, mark dirty. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, affected: number[] | 'all', reloadPages = false) => {
      setBusy(true)
      try {
        session.undo.push(await pdf.save(doc))
        if (session.undo.length > 15) session.undo.shift()
        await fn()
        if (reloadPages) {
          const p = await pdf.pages(doc)
          session.pages = p
          setPages(p)
          setVersions((v) => p.map((_, i) => (v[i] ?? 0) + 1))
          p.forEach((_, i) => void refreshPage(i))
        } else {
          const list = affected === 'all' ? pages.map((_, i) => i) : affected
          setVersions((v) => v.map((n, i) => (list.includes(i) ? n + 1 : n)))
          list.forEach((i) => void refreshPage(i))
        }
        docs.pdfChanged(tabId)
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setBusy(false)
      }
    },
    [doc, pages, refreshPage, session, tabId]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
      if (useApp.getState().active !== tabId || (e.target as HTMLElement | null)?.closest('input, textarea')) return
      e.preventDefault()
      void undoRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabId])

  const undo = async () => {
    const snap = session.undo.pop()
    if (!snap) return toast('Nothing to undo')
    setBusy(true)
    try {
      await pdf.close(doc)
      const o = await pdf.open(snap)
      session.doc = o.id
      session.pages = o.pages
      setDoc(o.id)
      setPages(o.pages)
      setVersions((v) => o.pages.map((_, i) => (v[i] ?? 0) + 1))
      docs.pdfChanged(tabId)
    } finally {
      setBusy(false)
    }
  }

  const undoRef = useRef(undo)
  undoRef.current = undo

  // ---------- search ----------
  const runSearch = async (q: string) => {
    setQuery(q)
    const h = q.trim() ? await pdf.search(doc, q.trim()) : []
    setHits(h)
    setHitIndex(0)
    if (h[0]) scrollToPage(h[0].page)
  }
  const scrollToPage = (i: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${i}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setCurrent(i)
  }

  // ---------- page operations ----------
  const pickPdf = () =>
    new Promise<Uint8Array | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/pdf'
      input.onchange = async () => resolve(input.files?.[0] ? new Uint8Array(await input.files[0].arrayBuffer()) : null)
      input.click()
    })

  const saveBytes = async (name: string, bytes: Uint8Array) => {
    const path = await window.simpleDocs.saveDialog(name, ['pdf'])
    if (!path) return
    await window.simpleDocs.writeFile(path, bytes)
    toast(`Saved ${path.split(/[\\/]/).pop()}`, 'success')
  }

  const pageOps = {
    rotate: (i: number, d: number) => mutate(() => pdf.rotate(doc, i, d), [i], true),
    remove: (i: number) => (pages.length > 1 ? mutate(() => pdf.deletePage(doc, i), 'all', true) : toast('A PDF needs at least one page', 'error')),
    blank: (i: number) => mutate(() => pdf.insertBlank(doc, i + 1, pages[i]?.width ?? 612, pages[i]?.height ?? 792), 'all', true),
    move: (i: number, dest: number) => dest >= 0 && dest < pages.length && mutate(() => pdf.movePages(doc, [i], dest), 'all', true),
    merge: async () => {
      const bytes = await pickPdf()
      if (bytes) await mutate(() => pdf.importBytes(doc, bytes, pages.length), 'all', true)
    },
    extract: async (i: number) => saveBytes(`Page ${i + 1}.pdf`, await pdf.extract(doc, [i])),
    split: async (i: number) => {
      if (i >= pages.length - 1) return toast('Choose a page before the last one to split after', 'info')
      const first = Array.from({ length: i + 1 }, (_, k) => k)
      const rest = Array.from({ length: pages.length - i - 1 }, (_, k) => i + 1 + k)
      await saveBytes(`Part 1 (pages 1-${i + 1}).pdf`, await pdf.extract(doc, first))
      await saveBytes(`Part 2 (pages ${i + 2}-${pages.length}).pdf`, await pdf.extract(doc, rest))
    }
  }

  const applyRedactions = async () => {
    setConfirmRedact(false)
    const entries = Object.entries(redactions).filter(([, r]) => r.length)
    await mutate(async () => {
      for (const [p, rects] of entries) await pdf.redact(doc, Number(p), rects)
    }, entries.map(([p]) => Number(p)))
    setRedactions({})
    toast('Redactions applied — the content was removed from the file', 'success')
  }

  // ---------- OCR ----------
  const pageHasText = async (i: number) => (await pdf.runs(doc, i)).reduce((n, r) => n + r.text.trim().length, 0) >= 10

  useEffect(() => {
    void pageHasText(0).then((has) => !has && toast('This PDF has no text layer (it looks scanned). Use Recognize text to make it searchable and selectable.', 'info'))
  }, [])

  /** OCR every page without a text layer and add the words as invisible text over the image. */
  const recognizeText = async () => {
    const todo: number[] = []
    for (let i = 0; i < pages.length; i++) if (!(await pageHasText(i))) todo.push(i)
    if (!todo.length) return toast('Every page already has text', 'info')
    const k = 200 / 72 // render at 200 dpi for recognition
    let found = 0
    await mutate(async () => {
      for (const [n, i] of todo.entries()) {
        setOcrStatus(`Recognizing page ${n + 1} of ${todo.length}…`)
        const png = new Uint8Array(await (await renderPng(doc, i, k)).arrayBuffer())
        const words = await window.simpleDocs.ocr(png)
        const map = mapper(pages[i], k)
        found += words.length
        await pdf.addInvisibleText(doc, i, words.map((w) => ({ text: w.text, rect: map.screenToRect([w.bbox[0], w.bbox[1]], [w.bbox[2], w.bbox[3]]) })))
      }
    }, todo).finally(() => setOcrStatus(null))
    toast(found ? `Recognized ${found} words on ${todo.length} page${todo.length > 1 ? 's' : ''}. The text is now searchable and selectable.` : 'No text was recognized', found ? 'success' : 'info')
  }

  const totalRedactions = Object.values(redactions).reduce((n, r) => n + r.length, 0)
  const ctx: PageCtx = { doc, s, tool, versions, hits, hitIndex, redactions, setRedactions, annots, fields, author, signature, mutate, setTool, setCurrent }

  return (
    <div className="flex h-full flex-col bg-workspace" data-testid="pdf-workspace">
      <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-panel px-2 [scrollbar-width:none]" role="toolbar" aria-label="PDF tools">
        {TOOLS.map((t) => (
          <Tip key={t.id} label={t.hint}>
            <button
              onClick={() => (t.id === 'sign' && !signature ? setSignOpen(true) : setTool(t.id))}
              aria-pressed={tool === t.id}
              aria-label={t.label}
              data-testid={`pdf-tool-${t.id}`}
              className={cx('flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-hover hover:text-text [&>svg]:size-4', tool === t.id && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
            >
              {t.icon}
              <span className="hidden min-[1640px]:inline">{t.label}</span>
            </button>
          </Tip>
        ))}
        {tool === 'sign' && signature && (
          <Btn size="sm" variant="ghost" onClick={() => setSignOpen(true)}>
            New signature
          </Btn>
        )}
        {totalRedactions > 0 && (
          <Btn size="sm" variant="danger" className="ml-1" onClick={() => setConfirmRedact(true)} data-testid="apply-redactions">
            Apply {totalRedactions} redaction{totalRedactions > 1 ? 's' : ''}
          </Btn>
        )}
        <div className="mx-1.5 h-6 w-px bg-border" />
        <Tip label="Recognize text in scanned pages (offline OCR, English)">
          <button onClick={recognizeText} disabled={busy} data-testid="pdf-ocr" aria-label="Recognize text" className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-hover hover:text-text disabled:opacity-50 [&>svg]:size-4">
            {ocrStatus ? <Loader2 className="animate-spin" /> : <ScanText />}
            <span className={ocrStatus ? undefined : 'hidden min-[1640px]:inline'}>{ocrStatus ?? 'Recognize text'}</span>
          </button>
        </Tip>
        <IconBtn label="Undo" onClick={undo} disabled={!session.undo.length || busy}>
          <Undo2 className="size-4" />
        </IconBtn>
        <div className="flex-1" />
        <div className="relative mr-1 w-40 shrink-0 min-[1200px]:w-56">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-3" />
          <input
            aria-label="Search PDF"
            placeholder="Search"
            value={query}
            onChange={(e) => void runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits.length) {
                const next = (hitIndex + (e.shiftKey ? -1 : 1) + hits.length) % hits.length
                setHitIndex(next)
                scrollToPage(hits[next].page)
              }
            }}
            className={cx(inputCls, 'h-7 pl-7 pr-12 text-[12px]')}
          />
          {query && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-text-3">{hits.length ? `${hitIndex + 1}/${hits.length}` : '0'}</span>}
        </div>
        <IconBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}>
          <ZoomOut className="size-4" />
        </IconBtn>
        <span className="w-11 text-center text-[12px] tabular-nums text-text-2">{Math.round(zoom * 100)}%</span>
        <IconBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))}>
          <ZoomIn className="size-4" />
        </IconBtn>
        <IconBtn label="Comments" active={panel === 'comments'} onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
          <MessageSquare className="size-4" />
        </IconBtn>
        <IconBtn label="Form fields" active={panel === 'forms'} onClick={() => setPanel(panel === 'forms' ? null : 'forms')}>
          <FormInput className="size-4" />
        </IconBtn>
        <IconBtn label="Document properties" active={panel === 'info'} onClick={() => setPanel(panel === 'info' ? null : 'info')}>
          <Info className="size-4" />
        </IconBtn>
        <Btn size="sm" variant="primary" className="ml-1" onClick={() => docs.save(tabId)} data-testid="pdf-save">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Btn>
      </div>

      <div className="flex min-h-0 flex-1">
        <Thumbnails doc={doc} pages={pages} versions={versions} current={current} onSelect={scrollToPage} ops={pageOps} />
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto" data-pdf-scroll>
          <div className="flex w-max min-w-full flex-col items-center gap-6 px-6 py-8">
            {pages.map((info, i) => (
              <PdfPage key={i} index={i} info={info} ctx={ctx} />
            ))}
          </div>
        </div>
        {panel && (
          <aside className="slide-up flex w-[300px] shrink-0 flex-col border-l border-border bg-panel">
            <div className="flex h-10 items-center justify-between border-b border-border px-3 text-[12.5px] font-semibold">
              {panel === 'comments' ? 'Comments & markup' : panel === 'forms' ? 'Form fields' : 'Document properties'}
              <IconBtn label="Close" size="sm" onClick={() => setPanel(null)}>
                <X className="size-3.5" />
              </IconBtn>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panel === 'comments' && <CommentsList annots={annots} onGo={scrollToPage} onDelete={(p, k) => mutate(() => pdf.removeAnnotation(doc, p, k), [p])} />}
              {panel === 'forms' && <FieldsList fields={fields} onGo={scrollToPage} onSet={(p, k, v) => mutate(() => pdf.setFieldValue(doc, p, k, v), [p])} />}
              {panel === 'info' && <InfoPanel tabId={tabId} doc={doc} />}
            </div>
          </aside>
        )}
      </div>

      {signOpen && (
        <SignatureDialog
          onClose={() => setSignOpen(false)}
          onDone={(png) => {
            setSignature(png)
            setSignOpen(false)
            setTool('sign')
            toast('Click on the page where the signature should go')
          }}
        />
      )}
      {confirmRedact && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirmRedact(false)}
          title="Apply redactions?"
          description="The marked text, images and graphics will be removed from the PDF permanently and covered in black. This cannot be reversed after you save."
          width={440}
          footer={
            <>
              <Btn onClick={() => setConfirmRedact(false)}>Cancel</Btn>
              <Btn variant="danger" onClick={applyRedactions} data-testid="confirm-redact">
                Redact permanently
              </Btn>
            </>
          }
        />
      )}
    </div>
  )
}

interface PageCtx {
  doc: number
  s: number
  tool: Tool
  versions: number[]
  hits: { page: number; boxes: Rect[] }[]
  hitIndex: number
  redactions: Record<number, Rect[]>
  setRedactions: (f: (r: Record<number, Rect[]>) => Record<number, Rect[]>) => void
  annots: Record<number, AnnotInfo[]>
  fields: Record<number, FieldInfo[]>
  author: string
  signature: Uint8Array | null
  mutate: (fn: () => Promise<unknown>, affected: number[] | 'all', reload?: boolean) => Promise<void>
  setTool: (t: Tool) => void
  setCurrent: (i: number) => void
}

function PdfPage({ index, info, ctx }: { index: number; info: { width: number; height: number; rotation: number }; ctx: PageCtx }) {
  const { doc, s, tool, versions } = ctx
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [runs, setRuns] = useState<TextRun[]>([])
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null)
  const [ink, setInk] = useState<[number, number][]>([])
  const [input, setInput] = useState<{ x: number; y: number; kind: 'text' | 'note' | 'edit'; value: string; run?: TextRun } | null>(null)
  const map = useMemo(() => mapper(info, s), [info, s])
  const w = info.width * s
  const h = info.height * s
  const version = versions[index] ?? 0

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting)
      if (e.isIntersecting && e.intersectionRatio > 0.4) ctx.setCurrent(index)
    }, { rootMargin: '600px 0px', threshold: [0, 0.4] })
    io.observe(el)
    return () => io.disconnect()
  }, [index])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    void pdf.render(doc, index, s * dpr).then((img) => {
      const c = canvas.current
      if (cancelled || !c) return
      c.width = img.width
      c.height = img.height
      c.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
    })
    return () => {
      cancelled = true
    }
  }, [visible, doc, index, s, version])

  const needsText = ['select', 'highlight', 'underline', 'strikeout', 'edit'].includes(tool)
  useEffect(() => {
    if (!visible || !needsText) return
    void pdf.lines(doc, index).then(setRuns)
  }, [visible, needsText, doc, index, version])

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = holder.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  /** Turn the current text selection into markup annotations on this page. */
  const markSelection = async () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !holder.current) return
    const r = holder.current.getBoundingClientRect()
    const quads: Rect[] = []
    for (let k = 0; k < sel.rangeCount; k++)
      for (const cr of Array.from(sel.getRangeAt(k).getClientRects())) {
        if (cr.width < 1 || cr.bottom < r.top || cr.top > r.bottom) continue
        quads.push(map.screenToRect([cr.left - r.left, cr.top - r.top], [cr.right - r.left, cr.bottom - r.top]))
      }
    sel.removeAllRanges()
    if (!quads.length) return
    const rect: Rect = [Math.min(...quads.map((q) => q[0])), Math.max(...quads.map((q) => q[1])), Math.max(...quads.map((q) => q[2])), Math.min(...quads.map((q) => q[3]))]
    await ctx.mutate(() => pdf.addAnnotation(doc, index, tool as 'highlight', { rect, quads, author: ctx.author }), [index])
  }

  const onPointerDown = (e: RPointerEvent) => {
    if (['redact', 'crop', 'field'].includes(tool)) {
      const p = local(e)
      setDrag({ a: p, b: p })
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } else if (tool === 'ink') {
      setInk([local(e)])
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }
  const onPointerMove = (e: RPointerEvent) => {
    if (drag) setDrag({ ...drag, b: local(e) })
    else if (ink.length) setInk((p) => [...p, local(e)])
  }
  const onPointerUp = async () => {
    if (drag) {
      const rect = map.screenToRect(drag.a, drag.b)
      setDrag(null)
      if (Math.abs(rect[2] - rect[0]) < 4 || Math.abs(rect[1] - rect[3]) < 4) return
      if (tool === 'redact') ctx.setRedactions((r) => ({ ...r, [index]: [...(r[index] ?? []), rect] }))
      else if (tool === 'crop') {
        await ctx.mutate(() => pdf.crop(doc, index, rect), [index], true)
        ctx.setTool('select')
      } else if (tool === 'field') {
        const w = rect[2] - rect[0]
        const box = w <= 24 && Math.abs(w - (rect[1] - rect[3])) < 6
        const name = `${box ? 'Check' : 'Text'}${Object.values(ctx.fields).flat().length + 1}`
        await ctx.mutate(() => pdf.createField(doc, index, box ? 'checkbox' : 'text', name, rect), [index])
      }
    } else if (ink.length > 1) {
      const pts = ink.map((p) => map.toPdf(p[0], p[1]))
      setInk([])
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      await ctx.mutate(() => pdf.addAnnotation(doc, index, 'ink', { rect: [Math.min(...xs) - 2, Math.max(...ys) + 2, Math.max(...xs) + 2, Math.min(...ys) - 2], ink: [pts], author: ctx.author, color: [30, 60, 200, 255] }), [index])
    }
  }

  const onClick = async (e: React.MouseEvent) => {
    const [x, y] = local(e)
    if (tool === 'note' || tool === 'text') setInput({ x, y, kind: tool, value: '' })
    else if (tool === 'sign' && ctx.signature) {
      const [px, py] = map.toPdf(x, y)
      await ctx.mutate(() => pdf.addPng(doc, index, ctx.signature!, [px, py + 25, px + 150, py - 25]), [index])
      ctx.setTool('select')
    }
  }

  const commitInput = async () => {
    if (!input) return
    const v = input.value
    const cur = input
    setInput(null)
    if (!v.trim() && cur.kind !== 'edit') return
    const [px, py] = map.toPdf(cur.x, cur.y)
    if (cur.kind === 'note') await ctx.mutate(() => pdf.addAnnotation(doc, index, 'note', { rect: [px, py, px + 20, py - 20], contents: v, author: ctx.author }), [index])
    else if (cur.kind === 'text') await ctx.mutate(() => pdf.addText(doc, index, px, py - 12, v, 12), [index])
    else if (cur.kind === 'edit' && cur.run && v !== cur.run.text) {
      let res: { ok: boolean; method: string; fontName: string } | null = null
      await ctx.mutate(async () => (res = await pdf.editText(doc, index, cur.run!.start, v, cur.run!.end)), [index])
      const r = res as { ok: boolean; method: string; fontName: string } | null
      if (!r?.ok) toast('This text could not be edited', 'error')
      else if (r.method === 'substitute-font') toast(`Edited. The original font is embedded as a subset without these characters, so ${r.fontName} was used.`, 'info')
      else toast('Text edited in the PDF', 'success')
    }
  }

  const hitsHere = ctx.hits.flatMap((hh, k) => (hh.page === index ? hh.boxes.map((b) => ({ b, current: k === ctx.hitIndex })) : []))
  const canText = map.rotation === 0

  return (
    <div
      ref={holder}
      data-pdf-page={index}
      className={cx('relative shrink-0 bg-white shadow-[var(--shadow-page)]', tool !== 'select' && tool !== 'edit' && !['highlight', 'underline', 'strikeout'].includes(tool) && 'cursor-crosshair')}
      style={{ width: w, height: h }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onMouseUp={() => ['highlight', 'underline', 'strikeout'].includes(tool) && void markSelection()}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-label={`Page ${index + 1}`} />
      {/* Selectable text layer */}
      {needsText && canText && (
        <div className="absolute inset-0 select-text" style={{ lineHeight: 1 }}>
          {runs.map((r, k) => {
            const box = map.rectToScreen(r.box)
            return (
              <span
                key={k}
                data-run={k}
                onClick={(e) => {
                  if (tool !== 'edit') return
                  e.stopPropagation()
                  setInput({ x: box.left, y: box.top, kind: 'edit', value: r.text, run: r })
                }}
                className={cx('absolute whitespace-pre text-transparent selection:bg-[#4f7cff55]', tool === 'edit' && 'cursor-text rounded-[2px] hover:bg-accent-soft hover:outline hover:outline-1 hover:outline-accent')}
                style={{ left: box.left, top: box.top, height: box.height, width: box.width, fontSize: box.height * 0.92, fontFamily: 'sans-serif' }}
              >
                {r.text}
              </span>
            )
          })}
        </div>
      )}
      {/* Search hits */}
      {hitsHere.map(({ b, current }, k) => {
        const r = map.rectToScreen(b)
        return <div key={`h${k}`} className={cx('pointer-events-none absolute rounded-[2px]', current ? 'bg-[#ff9f1c66] outline outline-2 outline-[#f08c00]' : 'bg-[#ffe58f88]')} style={r} />
      })}
      {/* Pending redactions */}
      {(ctx.redactions[index] ?? []).map((b, k) => (
        <div key={`r${k}`} className="absolute border-2 border-danger bg-danger/20" style={map.rectToScreen(b)} data-testid="pending-redaction">
          <button className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-danger text-white" onClick={(e) => (e.stopPropagation(), ctx.setRedactions((r) => ({ ...r, [index]: r[index].filter((_, i) => i !== k) })))} aria-label="Remove redaction mark">
            <X className="size-3" />
          </button>
        </div>
      ))}
      {/* Fillable fields */}
      {(tool === 'select' || tool === 'field') &&
        (ctx.fields[index] ?? [])
          .filter((f) => f.type === 'text' || f.type === 'checkbox')
          .map((f) => {
            const r = map.rectToScreen(f.rect)
            return f.type === 'checkbox' ? (
              <input
                key={f.annotIndex}
                type="checkbox"
                aria-label={f.name}
                defaultChecked={f.checked}
                onChange={(e) => void ctx.mutate(() => pdf.setFieldValue(doc, index, f.annotIndex, e.target.checked ? 'Yes' : 'Off'), [index])}
                className="absolute accent-[var(--accent)]"
                style={{ ...r }}
              />
            ) : (
              <input
                key={f.annotIndex}
                aria-label={f.name}
                defaultValue={f.value}
                onBlur={(e) => e.target.value !== f.value && void ctx.mutate(() => pdf.setFieldValue(doc, index, f.annotIndex, e.target.value), [index])}
                className="absolute border border-accent/40 bg-accent/5 px-1 text-black outline-none focus:border-accent focus:bg-white"
                style={{ ...r, fontSize: Math.max(9, r.height * 0.6) }}
                data-testid="pdf-field"
              />
            )
          })}
      {/* Drag rectangle / ink preview */}
      {drag && <div data-testid="pdf-drag" className={cx('pointer-events-none absolute border-2', tool === 'redact' ? 'border-danger bg-danger/15' : tool === 'field' ? 'border-accent bg-accent/10' : 'border-accent border-dashed')} style={{ left: Math.min(drag.a[0], drag.b[0]), top: Math.min(drag.a[1], drag.b[1]), width: Math.abs(drag.b[0] - drag.a[0]), height: Math.abs(drag.b[1] - drag.a[1]) }} />}
      {ink.length > 1 && (
        <svg className="pointer-events-none absolute inset-0" width={w} height={h}>
          <polyline points={ink.map((p) => p.join(',')).join(' ')} fill="none" stroke="#1e3cc8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {/* Inline input for notes / new text / text edits */}
      {input && (
        <div className="absolute z-10" style={{ left: input.x, top: input.y }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={input.value}
            onChange={(e) => setInput({ ...input, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void commitInput()
              }
              if (e.key === 'Escape') setInput(null)
            }}
            onBlur={() => void commitInput()}
            placeholder={input.kind === 'note' ? 'Comment…' : input.kind === 'edit' ? '' : 'Text…'}
            aria-label={input.kind === 'edit' ? 'Edit text' : input.kind === 'note' ? 'Note text' : 'New text'}
            data-testid="pdf-input"
            rows={input.kind === 'note' ? 3 : 1}
            className="min-w-[180px] resize rounded-md border-2 border-accent bg-white px-1.5 py-0.5 text-[13px] text-black shadow-lg outline-none"
            style={input.kind === 'edit' && input.run ? { width: Math.max(180, map.rectToScreen(input.run.box).width + 40) } : undefined}
          />
        </div>
      )}
      <span className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] text-text-3">{index + 1}</span>
    </div>
  )
}

function Thumbnails({
  doc,
  pages,
  versions,
  current,
  onSelect,
  ops
}: {
  doc: number
  pages: { width: number; height: number; rotation: number }[]
  versions: number[]
  current: number
  onSelect: (i: number) => void
  ops: { rotate: (i: number, d: number) => void; remove: (i: number) => void; blank: (i: number) => void; move: (i: number, dest: number) => void; merge: () => void; extract: (i: number) => void; split: (i: number) => void }
}) {
  return (
    <aside className="flex w-[176px] shrink-0 flex-col border-r border-border bg-panel" aria-label="Pages">
      <div className="flex h-10 items-center gap-0.5 border-b border-border px-2">
        <span className="flex-1 text-[12px] font-semibold text-text-2">Pages</span>
        <IconBtn label="Insert blank page after the current one" size="sm" onClick={() => ops.blank(current)}>
          <FilePlus2 className="size-3.5" />
        </IconBtn>
        <IconBtn label="Insert pages from another PDF (merge)" size="sm" onClick={ops.merge} data-testid="pdf-merge">
          <Files className="size-3.5" />
        </IconBtn>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {pages.map((p, i) => (
          <div key={i} className="group">
            <button onClick={() => onSelect(i)} className={cx('block w-full overflow-hidden rounded-md border-2 bg-white transition-colors', current === i ? 'border-accent' : 'border-transparent hover:border-border-strong')} aria-label={`Go to page ${i + 1}`}>
              <Thumb doc={doc} index={i} info={p} version={versions[i] ?? 0} />
            </button>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-text-3">{i + 1}</span>
              <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <IconBtn label="Rotate left" size="sm" onClick={() => ops.rotate(i, -90)}>
                  <RotateCcw className="size-3" />
                </IconBtn>
                <IconBtn label="Rotate right" size="sm" onClick={() => ops.rotate(i, 90)} data-testid={`rotate-${i}`}>
                  <RotateCw className="size-3" />
                </IconBtn>
                <IconBtn label="Move up" size="sm" onClick={() => ops.move(i, i - 1)}>
                  <ChevronUp className="size-3" />
                </IconBtn>
                <IconBtn label="Move down" size="sm" onClick={() => ops.move(i, i + 1)}>
                  <ChevronDown className="size-3" />
                </IconBtn>
                <IconBtn label="Extract page to a new PDF" size="sm" onClick={() => ops.extract(i)}>
                  <ArrowUp className="size-3 rotate-45" />
                </IconBtn>
                <IconBtn label="Split the PDF after this page" size="sm" onClick={() => ops.split(i)}>
                  <Scissors className="size-3" />
                </IconBtn>
                <IconBtn label="Delete page" size="sm" onClick={() => ops.remove(i)} data-testid={`delete-${i}`}>
                  <Trash2 className="size-3" />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function Thumb({ doc, index, info, version }: { doc: number; index: number; info: { width: number; height: number }; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    void pdf.render(doc, index, 140 / info.width).then((img) => {
      const c = ref.current
      if (cancelled || !c) return
      c.width = img.width
      c.height = img.height
      c.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
    })
    return () => {
      cancelled = true
    }
  }, [doc, index, info.width, version])
  return <canvas ref={ref} className="block h-auto w-full" style={{ aspectRatio: `${info.width} / ${info.height}` }} />
}

function CommentsList({ annots, onGo, onDelete }: { annots: Record<number, AnnotInfo[]>; onGo: (i: number) => void; onDelete: (page: number, index: number) => void }) {
  const list = Object.entries(annots).flatMap(([p, a]) => a.map((x) => ({ page: Number(p), ...x })))
  if (!list.length) return <p className="py-6 text-center text-[12.5px] text-text-3">No comments or markup yet. Use Highlight, Note or Draw to add some.</p>
  const icon = (k: string) => ({ highlight: <Highlighter className="size-3.5" />, underline: <Underline className="size-3.5" />, strikeout: <Strikethrough className="size-3.5" />, note: <MessageSquare className="size-3.5" />, ink: <PenLine className="size-3.5" /> })[k] ?? <SquareDashed className="size-3.5" />
  return (
    <ul className="space-y-2" data-testid="pdf-comments">
      {list.map((a) => (
        <li key={`${a.page}-${a.index}`} className="group rounded-lg border border-border bg-panel-2 p-2.5">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-accent">{icon(a.kind)}</span>
            <button className="font-medium capitalize hover:underline" onClick={() => onGo(a.page)}>
              {a.kind} · page {a.page + 1}
            </button>
            <span className="flex-1" />
            <IconBtn label="Delete" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => onDelete(a.page, a.index)}>
              <Trash2 className="size-3" />
            </IconBtn>
          </div>
          {a.author && <div className="mt-1 text-[11px] text-text-3">{a.author}</div>}
          {a.contents && <p className="mt-1 whitespace-pre-wrap text-[12.5px]">{a.contents}</p>}
        </li>
      ))}
    </ul>
  )
}

function FieldsList({ fields, onGo, onSet }: { fields: Record<number, FieldInfo[]>; onGo: (i: number) => void; onSet: (page: number, annot: number, v: string) => void }) {
  const list = Object.entries(fields).flatMap(([p, f]) => f.map((x) => ({ page: Number(p), ...x })))
  if (!list.length) return <p className="py-6 text-center text-[12.5px] text-text-3">This PDF has no form fields.</p>
  return (
    <ul className="space-y-2">
      {list.map((f) => (
        <li key={`${f.page}-${f.annotIndex}`} className="rounded-lg border border-border p-2.5">
          <button className="text-[12px] font-medium hover:underline" onClick={() => onGo(f.page)}>
            {f.name || 'Unnamed field'} <span className="font-normal text-text-3">· {f.type} · p.{f.page + 1}</span>
          </button>
          {f.type === 'text' && <input className={cx(inputCls, 'mt-1.5 h-7 text-[12px]')} defaultValue={f.value} onBlur={(e) => e.target.value !== f.value && onSet(f.page, f.annotIndex, e.target.value)} aria-label={f.name} />}
          {f.type === 'checkbox' && (
            <label className="mt-1.5 flex items-center gap-2 text-[12px]">
              <input type="checkbox" defaultChecked={f.checked} onChange={(e) => onSet(f.page, f.annotIndex, e.target.checked ? 'Yes' : 'Off')} className="accent-[var(--accent)]" /> Checked
            </label>
          )}
          {!['text', 'checkbox'].includes(f.type) && <div className="mt-1 text-[12px] text-text-2">{f.value || '—'}</div>}
        </li>
      ))}
    </ul>
  )
}

function InfoPanel({ tabId, doc }: { tabId: string; doc: number }) {
  const session = pdfSessions.get(tabId)!
  const fields: [keyof typeof session.meta, string, string][] = [
    ['title', 'Title', 'Title'],
    ['author', 'Author', 'Author'],
    ['subject', 'Subject', 'Subject'],
    ['keywords', 'Keywords', 'Keywords']
  ]
  return (
    <div className="space-y-3">
      {fields.map(([k, label, key]) => (
        <label key={k} className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-2">{label}</span>
          <input
            className={inputCls}
            defaultValue={session.meta[k]}
            aria-label={`PDF ${label}`}
            onBlur={async (e) => {
              if (e.target.value === session.meta[k]) return
              session.meta[k] = e.target.value
              await pdf.setMeta(doc, key, e.target.value)
              docs.pdfChanged(tabId)
            }}
          />
        </label>
      ))}
      <p className="text-[11.5px] leading-relaxed text-text-3">Page count: {session.pages.length}. Changes are written when you save.</p>
    </div>
  )
}

function SignatureDialog({ onClose, onDone }: { onClose: () => void; onDone: (png: Uint8Array) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const pos = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return [((e.clientX - r.left) * ref.current!.width) / r.width, ((e.clientY - r.top) * ref.current!.height) / r.height] as const
  }
  const toPng = async (canvas: HTMLCanvasElement) => new Uint8Array(await (await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'))).arrayBuffer())
  const fromImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      const bmp = await createImageBitmap(f)
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')!.drawImage(bmp, 0, 0)
      onDone(await toPng(c))
    }
    input.click()
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Signature or image"
      description="Draw your signature below, or choose an image (PNG, JPEG) to place on the page."
      width={520}
      footer={
        <>
          <Btn variant="ghost" className="mr-auto" onClick={fromImage}>
            <ImagePlus className="size-3.5" /> Choose image…
          </Btn>
          <Btn
            onClick={() => {
              ref.current!.getContext('2d')!.clearRect(0, 0, 600, 200)
              setHasInk(false)
            }}
          >
            Clear
          </Btn>
          <Btn variant="primary" disabled={!hasInk} onClick={async () => onDone(await toPng(ref.current!))}>
            Use signature
          </Btn>
        </>
      }
    >
      <canvas
        ref={ref}
        width={600}
        height={200}
        aria-label="Signature pad"
        className="h-[160px] w-full touch-none rounded-lg border border-dashed border-border-strong bg-white"
        onPointerDown={(e) => {
          const [x, y] = pos(e)
          const g = ref.current!.getContext('2d')!
          g.lineWidth = 3
          g.lineCap = 'round'
          g.strokeStyle = '#1b2a6b'
          g.beginPath()
          g.moveTo(x, y)
          setDrawing(true)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drawing) return
          const [x, y] = pos(e)
          const g = ref.current!.getContext('2d')!
          g.lineTo(x, y)
          g.stroke()
          setHasInk(true)
        }}
        onPointerUp={() => setDrawing(false)}
      />
    </Modal>
  )
}

