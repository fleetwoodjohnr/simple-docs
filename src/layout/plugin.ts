import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { TableMap } from '@tiptap/pm/tables'
import { Extension } from '@tiptap/core'
import { computeBreaks, sameBreaks, type Break, type Layout, type Line, type PageMetrics, type Unit } from './breaks'
import { makePageSetup, ptToPx, resolveStyle, type PageSetup, type StyleMap } from '@/editor/model'
import { notesKey, type NoteRef } from '@/editor/notes'

export const PAGE_GAP = 32

export interface PaginationState {
  breaks: Break[]
  pageCount: number
  overflow: number[]
  deco: DecorationSet
  /** Bumped whenever a new layout is applied. */
  version: number
}

export const paginationKey = new PluginKey<PaginationState>('pagination')

export function pageOf(doc: PMNode): PageSetup {
  return (doc.attrs.page as PageSetup | null) ?? makePageSetup()
}

export function metricsFor(page: PageSetup): PageMetrics {
  const h = ptToPx(page.height)
  return {
    contentHeight: h - ptToPx(page.margins.top) - ptToPx(page.margins.bottom),
    stride: h + PAGE_GAP,
    contentTop: ptToPx(page.margins.top)
  }
}

// ---------- spacer DOM ----------

function spacer(tag: 'div' | 'span', height: number, cls: string) {
  const el = document.createElement(tag)
  el.className = cls
  el.setAttribute('data-pg-spacer', '')
  el.setAttribute('aria-hidden', 'true')
  el.style.height = `${height}px`
  return el
}

function rowSpacer(height: number, cols: number) {
  const tr = document.createElement('tr')
  tr.className = 'pg-spacer-row'
  tr.setAttribute('data-pg-spacer', '')
  tr.setAttribute('aria-hidden', 'true')
  const td = document.createElement('td')
  td.colSpan = Math.max(1, cols)
  td.style.height = `${height}px`
  tr.appendChild(td)
  return tr
}

function buildDecorations(doc: PMNode, breaks: Break[]): DecorationSet {
  const decos = breaks.map((b, i) => {
    const key = `pg${i}:${b.kind}:${b.height.toFixed(1)}`
    if (b.kind === 'inline') return Decoration.widget(b.pos, () => spacer('span', b.height, 'pg-spacer pg-spacer-inline'), { side: -1, key, ignoreSelection: true })
    if (b.kind === 'row') {
      const $p = doc.resolve(b.pos)
      const table = $p.parent.type.name === 'table' ? $p.parent : null
      const cols = table ? TableMap.get(table).width : 1
      return Decoration.widget(b.pos, () => rowSpacer(b.height, cols), { side: -1, key: key + cols, ignoreSelection: true })
    }
    return Decoration.widget(b.pos, () => spacer('div', b.height, 'pg-spacer'), { side: -1, key, ignoreSelection: true })
  })
  return DecorationSet.create(doc, decos)
}

// ---------- measurement ----------

interface Measurer {
  natural(clientY: number): number
  scale: number
  rootTop: number
}

function makeMeasurer(root: HTMLElement): Measurer {
  const rr = root.getBoundingClientRect()
  const scale = rr.width / (root.offsetWidth || rr.width || 1) || 1
  const spacers = Array.from(root.querySelectorAll<HTMLElement>('[data-pg-spacer]')).map((el) => {
    const r = el.getBoundingClientRect()
    return { top: (r.top - rr.top) / scale, h: r.height / scale }
  })
  // Prefix sums so natural() is a binary search.
  const cum: number[] = []
  spacers.reduce((acc, s, i) => (cum[i] = acc + s.h), 0)
  return {
    scale,
    rootTop: rr.top,
    natural(clientY) {
      const y = (clientY - rr.top) / scale
      let lo = 0
      let hi = spacers.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (spacers[mid].top < y - 0.25) lo = mid + 1
        else hi = mid
      }
      return y - (lo ? cum[lo - 1] : 0)
    }
  }
}

/** Top of a character's box (client coords), or null if it has no box. */
function charTop(range: Range, node: Text, off: number): number | null {
  range.setStart(node, off)
  range.setEnd(node, off + 1)
  const r = range.getClientRects()
  return r.length ? r[r.length - 1].top : null
}

/**
 * Line boxes of a textblock in natural coordinates. A line's document position is
 * resolved lazily (binary search over character boxes) because only the line where
 * a page splits ever needs it.
 */
function measureLines(view: EditorView, dom: HTMLElement, m: Measurer): Line[] {
  const items: (Text | Element)[] = []
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && (n as Element).hasAttribute('data-pg-spacer') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      if (!n.nodeValue) continue
      items.push(n as Text)
      range.selectNodeContents(n)
      for (const r of Array.from(range.getClientRects())) if (r.height > 0) rects.push(r)
    } else if ((n as Element).tagName === 'IMG' || (n as Element).classList.contains('sd-preserved-inline')) {
      items.push(n as Element)
      const r = (n as Element).getBoundingClientRect()
      if (r.height > 0) rects.push(r)
    }
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left)
  const boxes: { top: number; bottom: number }[] = []
  for (const r of rects) {
    const cur = boxes[boxes.length - 1]
    if (cur && (r.top + r.bottom) / 2 < cur.bottom) {
      cur.top = Math.min(cur.top, r.top)
      cur.bottom = Math.max(cur.bottom, r.bottom)
    } else boxes.push({ top: r.top, bottom: r.bottom })
  }

  /** First document position whose character box starts on or below `top` (client px). */
  const posAtLineTop = (top: number): number | null => {
    for (const item of items) {
      if (item.nodeType === 1) {
        if ((item as Element).getBoundingClientRect().top >= top - 1) return view.posAtDOM(item, 0)
        continue
      }
      const t = item as Text
      const len = t.length
      const last = charTop(range, t, len - 1)
      if (last == null || last < top - 1) continue
      let lo = 0
      let hi = len - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const ct = charTop(range, t, mid)
        if (ct != null && ct >= top - 1) hi = mid
        else lo = mid + 1
      }
      return view.posAtDOM(t, lo)
    }
    return null
  }

  return boxes.map((b, i) => {
    let pos: number | undefined
    return {
      top: m.natural(b.top),
      bottom: m.natural(b.bottom),
      get pos() {
        if (pos === undefined) pos = (i === 0 ? null : posAtLineTop(b.top)) ?? -1
        return pos
      }
    }
  })
}

/** Minimal shape of prosemirror-view's internal ViewDesc tree (stable for years; used for O(n) node→DOM mapping). */
interface Desc {
  node?: PMNode
  dom: Node
  size: number
  children: Desc[]
}

const NO_HOIST = new Set(['doc', 'tableCell', 'tableHeader'])

/** Measures a note's rendered height (px); supplied by the app so layout stays schema-agnostic. */
export type NoteHeightFn = (view: EditorView, note: NoteRef) => number

export function measureUnits(view: EditorView, noteHeight?: NoteHeightFn): Unit[] {
  const doc = view.state.doc
  const root = view.dom as HTMLElement
  const m = makeMeasurer(root)
  const styles = (doc.attrs.styles as StyleMap | null) ?? {}
  const styleCache = new Map<string, ReturnType<typeof resolveStyle>['para']>()
  const styleFor = (node: PMNode) => {
    const id = (node.attrs.styleId as string | null) ?? (node.type.name === 'heading' ? `Heading${node.attrs.level}` : 'Normal')
    let p = styleCache.get(id)
    if (!p) styleCache.set(id, (p = resolveStyle(styles, id).para))
    return p
  }
  const units: Unit[] = []
  const box = (el: Node | null) => {
    if (!el || !(el instanceof HTMLElement)) return null
    const r = el.getBoundingClientRect()
    return { top: m.natural(r.top), bottom: m.natural(r.bottom) }
  }

  /**
   * Walk the view's desc tree once. `pos` is the position at the start of `parent`'s
   * content; `hoist` is where a break should go if the first child moves to a new page.
   */
  const walk = (parent: Desc, parentNode: PMNode, pos: number, hoist: number) => {
    let p = pos
    let first = true
    for (const d of parent.children) {
      const node = d.node
      if (!node) {
        p += d.size
        continue
      }
      const at = first && !NO_HOIST.has(parentNode.type.name) ? hoist : p
      first = false
      const name = node.type.name
      if (name === 'table') {
        let rp = p + 1
        let i = 0
        const rows = (d.children ?? []).filter((c) => c.node)
        for (const row of rows) {
          const b = box(row.dom)
          if (b) units.push({ pos: i === 0 ? at : rp, ...b, kind: 'row', keepNext: false, keepLines: true, breakBefore: false })
          rp += row.node!.nodeSize
          i++
        }
      } else if (node.isTextblock) {
        const b = box(d.dom)
        const dom = d.dom as HTMLElement
        if (b) {
          const st = name === 'paragraph' || name === 'heading' ? styleFor(node) : {}
          let lines: Line[] | undefined
          let notes: Unit['notes']
          if (noteHeight && noteByPos.size) {
            node.forEach((child, off) => {
              const note = child.type.name === 'footnote' ? noteByPos.get(p + 1 + off) : undefined
              if (!note || note.kind !== 'footnote') return
              const el = view.nodeDOM(p + 1 + off) as HTMLElement | null
              const r = el?.getBoundingClientRect()
              if (r) (notes ??= []).push({ y: m.natural(r.top), h: noteHeight(view, note) })
            })
          }
          units.push({
            notes,
            pos: at,
            ...b,
            kind: 'text',
            keepNext: Boolean(node.attrs.keepNext || st.keepNext),
            keepLines: Boolean(node.attrs.keepLines || st.keepLines),
            breakBefore: Boolean(node.attrs.pageBreakBefore || st.pageBreakBefore),
            lines: () => (lines ??= measureLines(view, dom, m))
          })
        }
      } else if (name === 'pageBreak') {
        const b = box(d.dom)
        if (b) units.push({ pos: p, ...b, kind: 'pagebreak', keepNext: false, keepLines: true, breakBefore: false })
      } else if (node.isBlock && node.isAtom) {
        const b = box(d.dom)
        if (b) units.push({ pos: at, ...b, kind: 'atom', keepNext: false, keepLines: true, breakBefore: false })
      } else if (!node.isInline && d.children?.length) {
        walk(d, node, p + 1, at)
      }
      p += d.size
    }
  }
  const allNotes = notesKey.getState(view.state)?.notes ?? []
  const noteByPos = new Map(allNotes.map((n) => [n.pos, n]))
  const docView = (view as unknown as { docView?: Desc }).docView
  if (docView?.children) walk(docView, doc, 0, 0)
  // Endnotes are printed at the end, after the last unit.
  const last = units[units.length - 1]
  if (noteHeight && last) for (const n of allNotes) if (n.kind === 'endnote') (last.notes ??= []).push({ y: last.top, h: noteHeight(view, n) })
  return units
}

export function paginate(view: EditorView, noteHeight?: NoteHeightFn): Layout {
  return computeBreaks(measureUnits(view, noteHeight), metricsFor(pageOf(view.state.doc)))
}

// ---------- plugin ----------

export interface PaginationOptions {
  onLayout?: (state: PaginationState) => void
  noteHeight?: NoteHeightFn
}

function PaginationPlugin(opts: PaginationOptions) {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: (_c, state) => ({ breaks: [], pageCount: 1, overflow: [], deco: DecorationSet.create(state.doc, []), version: 0 }),
      apply(tr, prev, _old, state: EditorState) {
        const layout = tr.getMeta(paginationKey) as Layout | undefined
        if (layout) return { ...layout, deco: buildDecorations(state.doc, layout.breaks), version: prev.version + 1 }
        if (!tr.docChanged) return prev
        return {
          ...prev,
          breaks: prev.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, -1) })),
          deco: prev.deco.map(tr.mapping, tr.doc)
        }
      }
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.deco
    },
    view(view) {
      let raf = 0
      let runs = 0
      const run = () => {
        raf = 0
        const root = view.dom as HTMLElement
        if (!root.isConnected || root.offsetParent === null) return
        const layout = paginate(view, opts.noteHeight)
        const prev = paginationKey.getState(view.state)!
        if (!sameBreaks(prev.breaks, layout.breaks) || prev.pageCount !== layout.pageCount) {
          // Guard against pathological oscillation: settle after a few passes per burst.
          if (++runs > 6) return
          view.dispatch(view.state.tr.setMeta(paginationKey, layout).setMeta('addToHistory', false).setMeta('pagination', true))
        } else {
          runs = 0
          opts.onLayout?.(prev)
        }
      }
      const schedule = () => {
        if (!raf) raf = requestAnimationFrame(run)
      }
      const ro = new ResizeObserver(schedule)
      ro.observe(view.dom)
      const onLoad = () => schedule()
      view.dom.addEventListener('load', onLoad, true)
      document.fonts?.addEventListener('loadingdone', onLoad)
      schedule()
      return {
        update(v, prevState) {
          if (v.state.doc !== prevState.doc) {
            runs = 0
            schedule()
          } else if (paginationKey.getState(v.state) !== paginationKey.getState(prevState)) schedule()
        },
        destroy() {
          cancelAnimationFrame(raf)
          ro.disconnect()
          view.dom.removeEventListener('load', onLoad, true)
          document.fonts?.removeEventListener('loadingdone', onLoad)
        }
      }
    }
  })
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagination: { repaginate: () => ReturnType }
  }
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',
  addOptions() {
    return {}
  },
  addProseMirrorPlugins() {
    return [PaginationPlugin(this.options)]
  },
  addCommands() {
    return {
      repaginate:
        () =>
        ({ view }) => {
          view.dispatch(view.state.tr.setMeta(paginationKey, paginate(view, this.options.noteHeight)).setMeta('addToHistory', false))
          return true
        }
    }
  }
})
