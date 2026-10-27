import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { DocAttrStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { TableMap } from '@tiptap/pm/tables'
import { Extension } from '@tiptap/core'
import { computeBreaks, sameBreaks, type Break, type Layout, type Line, type PageMetrics, type Unit } from './breaks'
import { makePageSetup, ptToPx, resolveStyle, type PageSetup, type StyleMap } from '@/editor/model'
import { notesKey, type NoteRef } from '@/editor/notes'

export const PAGE_GAP = 32

export interface PaginationState {
  /** Range edited since the last layout (current doc positions), or 'full' when everything must be re-measured. */
  dirty: { from: number; to: number } | 'full' | null
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
      const spacerDeco = Decoration.widget(b.pos, () => rowSpacer(b.height, cols), { side: -2, key: key + cols, ignoreSelection: true })
      if (!b.repeat || !table) return spacerDeco
      const firstRow = $p.start()
      const header = Decoration.widget(b.pos, (view) => repeatedHeader(view, firstRow), { side: -1, key: `${key}h${b.repeat.toFixed(1)}`, ignoreSelection: true })
      return [spacerDeco, header]
    }
    return Decoration.widget(b.pos, () => spacer('div', b.height, 'pg-spacer'), { side: -1, key, ignoreSelection: true })
  })
  return DecorationSet.create(doc, decos.flat())
}

/** A read-only copy of a table's header row, shown at the top of a continuation page. */
function repeatedHeader(view: EditorView, firstRowPos: number): HTMLElement {
  const src = view.nodeDOM(firstRowPos) as HTMLElement | null
  const tr = (src?.cloneNode(true) as HTMLElement | undefined) ?? document.createElement('tr')
  tr.setAttribute('data-pg-repeat', '')
  tr.setAttribute('aria-hidden', 'true')
  tr.setAttribute('contenteditable', 'false')
  tr.querySelectorAll('.selectedCell, .column-resize-handle').forEach((el) => (el.classList.remove('selectedCell'), el.classList.contains('column-resize-handle') && el.remove()))
  return tr
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
  const spacers = Array.from(root.querySelectorAll<HTMLElement>('[data-pg-spacer], [data-pg-repeat]')).map((el) => {
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
  // One range over the whole paragraph: rects for every inline box, minus our own spacers.
  const range = document.createRange()
  range.selectNodeContents(dom)
  const spacerRects = Array.from(dom.querySelectorAll('[data-pg-spacer]'), (el) => el.getBoundingClientRect())
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.height > 0 && r.width > 0 && !spacerRects.some((sr) => Math.abs(sr.top - r.top) < 0.5 && Math.abs(sr.height - r.height) < 0.5)
  )
  let items: (Text | Element)[] | null = null
  const collectItems = () => {
    const out: (Text | Element)[] = []
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && (n as Element).hasAttribute('data-pg-spacer') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    })
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3 ? !!n.nodeValue : (n as Element).tagName === 'IMG' || (n as Element).classList.contains('sd-preserved-inline')) out.push(n as Text | Element)
    }
    return out
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
    for (const item of (items ??= collectItems())) {
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

/**
 * Flow units in document order, measured lazily: a unit's box (and its footnotes) is read
 * only when the breaking algorithm looks at it, so an incremental pass that stops early
 * never touches the rest of the document. Units ending before `fromPos` are skipped.
 */
export function measureUnits(view: EditorView, noteHeight?: NoteHeightFn, fromPos = 0): Unit[] {
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
  const allNotes = notesKey.getState(view.state)?.notes ?? []
  const noteByPos = new Map(allNotes.map((n) => [n.pos, n]))

  /** A unit whose geometry is measured on first access. */
  const lazyUnit = (el: Node, base: Omit<Unit, 'top' | 'bottom'>, notesAt?: { contentPos: number; node: PMNode }): Unit => {
    let b: { top: number; bottom: number } | undefined
    let notes: Unit['notes'] | null = null
    const box = () => {
      if (!b) {
        const r = el instanceof HTMLElement ? el.getBoundingClientRect() : null
        b = r ? { top: m.natural(r.top), bottom: m.natural(r.bottom) } : { top: 0, bottom: 0 }
      }
      return b
    }
    return {
      ...base,
      get top() {
        return box().top
      },
      get bottom() {
        return box().bottom
      },
      get notes() {
        if (notes === null) {
          notes = undefined
          if (notesAt && noteHeight && noteByPos.size)
            notesAt.node.forEach((child, off) => {
              const note = child.type.name === 'footnote' ? noteByPos.get(notesAt.contentPos + off) : undefined
              if (!note || note.kind !== 'footnote') return
              const r = (view.nodeDOM(notesAt.contentPos + off) as HTMLElement | null)?.getBoundingClientRect()
              if (r) (notes ??= []).push({ y: m.natural(r.top), h: noteHeight(view, note) })
            })
        }
        return notes
      },
      set notes(v) {
        notes = v
      }
    }
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
      if (!node || p + d.size <= fromPos) {
        if (node) first = false
        p += d.size
        continue
      }
      const at = first && !NO_HOIST.has(parentNode.type.name) ? hoist : p
      first = false
      const name = node.type.name
      const flags = { keepNext: false, keepLines: true, breakBefore: false }
      if (name === 'table') {
        let rp = p + 1
        let i = 0
        const rows = (d.children ?? []).filter((c) => c.node)
        const hasHeader = rows.length > 1 && rows[0].node!.childCount > 0 && rows[0].node!.content.content.every((c) => c.type.name === 'tableHeader')
        const headerUnit = hasHeader ? lazyUnit(rows[0].dom, { pos: at, kind: 'row', ...flags }) : null
        for (const row of rows) {
          if (rp + row.size > fromPos) {
            const unit = i === 0 && headerUnit ? headerUnit : lazyUnit(row.dom, { pos: i === 0 ? at : rp, kind: 'row', ...flags })
            if (headerUnit && i > 0) Object.defineProperty(unit, 'repeatHeader', { get: () => headerUnit.bottom - headerUnit.top, enumerable: true })
            units.push(unit)
          }
          rp += row.node!.nodeSize
          i++
        }
      } else if (node.isTextblock) {
        const dom = d.dom as HTMLElement
        const st = name === 'paragraph' || name === 'heading' ? styleFor(node) : {}
        let lines: Line[] | undefined
        units.push(
          lazyUnit(
            dom,
            {
              pos: at,
              kind: 'text',
              keepNext: Boolean(node.attrs.keepNext || st.keepNext),
              keepLines: Boolean(node.attrs.keepLines || st.keepLines),
              breakBefore: Boolean(node.attrs.pageBreakBefore || st.pageBreakBefore),
              lines: () => (lines ??= measureLines(view, dom, m))
            },
            { contentPos: p + 1, node }
          )
        )
      } else if (name === 'pageBreak' || (name === 'sectionBreak' && node.attrs.kind !== 'continuous')) {
        units.push(lazyUnit(d.dom, { pos: p, kind: 'pagebreak', ...flags }))
      } else if (node.isBlock && node.isAtom) {
        units.push(lazyUnit(d.dom, { pos: at, kind: 'atom', ...flags }))
      } else if (!node.isInline && d.children?.length) {
        walk(d, node, p + 1, at)
      }
      p += d.size
    }
  }
  const docView = (view as unknown as { docView?: Desc }).docView
  if (docView?.children) walk(docView, doc, 0, 0)
  // Endnotes are printed at the end, after the last unit.
  const last = units[units.length - 1]
  const endnotes = allNotes.filter((n) => n.kind === 'endnote')
  if (noteHeight && last && endnotes.length) last.notes = [...(last.notes ?? []), ...endnotes.map((n) => ({ y: last.top, h: noteHeight(view, n) }))]
  return units
}

export function paginate(view: EditorView, noteHeight?: NoteHeightFn): Layout {
  return computeBreaks(measureUnits(view, noteHeight), metricsFor(pageOf(view.state.doc)))
}

/** Re-layout from one page before the edited range, reusing the old layout once it re-converges. */
export function paginateFrom(view: EditorView, prev: Break[], dirty: { from: number; to: number }, noteHeight?: NoteHeightFn): Layout {
  const metrics = metricsFor(pageOf(view.state.doc))
  const k = Math.max(0, prev.filter((b) => b.pos <= dirty.from).length - 1)
  if (k === 0) return computeBreaks(measureUnits(view, noteHeight), metrics, { prefix: [], start: metrics.contentTop, prev, changeEnd: dirty.to })
  const from = prev[k - 1]
  return computeBreaks(measureUnits(view, noteHeight, from.pos), metrics, { prefix: prev.slice(0, k), start: from.start, prev, changeEnd: dirty.to })
}

// ---------- plugin ----------

export interface PaginationOptions {
  onLayout?: (state: PaginationState) => void
  noteHeight?: NoteHeightFn
}

/** Accumulate the changed range of a transaction (or 'full' for document-level changes). */
function mergeDirty(prev: PaginationState['dirty'], tr: Transaction): PaginationState['dirty'] {
  if (prev === 'full') return 'full'
  if (tr.steps.some((st) => st instanceof DocAttrStep) || tr.steps.length > 50) return 'full'
  let from = prev ? tr.mapping.map(prev.from, -1) : Infinity
  let to = prev ? tr.mapping.map(prev.to, 1) : -Infinity
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1)
    map.forEach((_os, _oe, ns, ne) => {
      from = Math.min(from, rest.map(ns, -1))
      to = Math.max(to, rest.map(ne, 1))
    })
  })
  return from === Infinity ? prev : { from, to }
}

function PaginationPlugin(opts: PaginationOptions) {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: (_c, state): PaginationState => ({ breaks: [], pageCount: 1, overflow: [], deco: DecorationSet.create(state.doc, []), version: 0, dirty: 'full' }),
      apply(tr, prev, _old, state: EditorState) {
        const layout = tr.getMeta(paginationKey) as Layout | undefined
        if (layout) {
          // Same breaks (an edit that did not move pages): keep the decorations, just clear the dirty range.
          if (sameBreaks(prev.breaks, layout.breaks) && prev.pageCount === layout.pageCount) return { ...prev, dirty: null }
          return { ...layout, deco: buildDecorations(state.doc, layout.breaks), version: prev.version + 1, dirty: null }
        }
        if (!tr.docChanged) return prev
        return {
          ...prev,
          breaks: prev.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, -1) })),
          deco: prev.deco.map(tr.mapping, tr.doc),
          dirty: mergeDirty(prev.dirty, tr)
        }
      }
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.deco
    },
    view(view) {
      let raf = 0
      let runs = 0
      let forceFull = true
      let lastHeight = -1
      const run = () => {
        raf = 0
        const root = view.dom as HTMLElement
        if (!root.isConnected || root.offsetParent === null) return
        const prev = paginationKey.getState(view.state)!
        const incremental = !forceFull && prev.dirty && prev.dirty !== 'full' && prev.breaks.length > 0
        const layout = incremental ? paginateFrom(view, prev.breaks, prev.dirty as { from: number; to: number }, opts.noteHeight) : paginate(view, opts.noteHeight)
        forceFull = false
        if (!sameBreaks(prev.breaks, layout.breaks) || prev.pageCount !== layout.pageCount) {
          // Guard against pathological oscillation: settle after a few passes per burst.
          if (++runs > 6) return
          view.dispatch(view.state.tr.setMeta(paginationKey, layout).setMeta('addToHistory', false).setMeta('pagination', true))
        } else {
          runs = 0
          if (prev.dirty) view.dispatch(view.state.tr.setMeta(paginationKey, layout).setMeta('addToHistory', false).setMeta('pagination', true))
          opts.onLayout?.(prev)
        }
        lastHeight = root.offsetHeight
      }
      const schedule = (full = false) => {
        if (full) forceFull = true
        if (!raf) raf = requestAnimationFrame(run)
      }
      // Size changes not caused by an edit (images, wrapping) need a full pass.
      const ro = new ResizeObserver(() => {
        if ((view.dom as HTMLElement).offsetHeight !== lastHeight) schedule(!paginationKey.getState(view.state)?.dirty)
      })
      ro.observe(view.dom)
      const onLoad = () => schedule(true)
      view.dom.addEventListener('load', onLoad, true)
      document.fonts?.addEventListener('loadingdone', onLoad)
      schedule(true)
      return {
        update(v, prevState) {
          if (v.state.doc !== prevState.doc) {
            runs = 0
            schedule()
          }
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
