import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { TableMap } from '@tiptap/pm/tables'
import { Extension } from '@tiptap/core'
import { computeBreaks, sameBreaks, type Break, type Layout, type Line, type PageMetrics, type Unit } from './breaks'
import { makePageSetup, ptToPx, resolveStyle, type PageSetup, type StyleMap } from '@/editor/model'

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

/** Hoist a break position out of containers when the unit is their first child (so list markers, table wrappers move too). */
function hoist(doc: PMNode, pos: number): number {
  const $p = doc.resolve(pos)
  let d = $p.depth
  while (d > 0 && $p.index(d) === 0 && $p.node(d).type.name !== 'tableCell' && $p.node(d).type.name !== 'tableHeader') {
    pos = $p.before(d)
    d--
  }
  return pos
}

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
  return {
    scale,
    rootTop: rr.top,
    natural(clientY) {
      const y = (clientY - rr.top) / scale
      let shift = 0
      for (const s of spacers) {
        if (s.top < y - 0.25) shift += s.h
        else break
      }
      return y - shift
    }
  }
}

function measureLines(view: EditorView, dom: HTMLElement, nodePos: number, nodeSize: number, m: Measurer, rtl: boolean): Line[] {
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && (n as Element).hasAttribute('data-pg-spacer') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  const range = document.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      if (!n.nodeValue) continue
      range.selectNodeContents(n)
      for (const r of Array.from(range.getClientRects())) if (r.height > 0) rects.push(r)
    } else if ((n as Element).tagName === 'IMG' || (n as Element).classList.contains('sd-preserved-inline')) {
      const r = (n as Element).getBoundingClientRect()
      if (r.height > 0) rects.push(r)
    }
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: { top: number; bottom: number; left: number; right: number }[] = []
  for (const r of rects) {
    const cur = lines[lines.length - 1]
    if (cur && (r.top + r.bottom) / 2 < cur.bottom) {
      cur.top = Math.min(cur.top, r.top)
      cur.bottom = Math.max(cur.bottom, r.bottom)
      cur.left = Math.min(cur.left, r.left)
      cur.right = Math.max(cur.right, r.right)
    } else lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
  }
  const out: Line[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    let pos = nodePos + 1
    if (i > 0) {
      const hit = view.posAtCoords({ left: rtl ? l.right - 1 : l.left + 1, top: (l.top + l.bottom) / 2 })
      if (!hit || hit.pos <= nodePos + 1 || hit.pos >= nodePos + nodeSize - 1) continue
      pos = hit.pos
    }
    out.push({ top: m.natural(l.top), bottom: m.natural(l.bottom), pos })
  }
  return out
}

export function measureUnits(view: EditorView): Unit[] {
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
  const box = (el: Element | null) => {
    if (!el || !(el instanceof HTMLElement)) return null
    const r = el.getBoundingClientRect()
    return { top: m.natural(r.top), bottom: m.natural(r.bottom) }
  }

  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'table') {
      let rowPos = pos + 1
      node.forEach((row, _o, i) => {
        const b = box(view.nodeDOM(rowPos) as Element)
        if (b) units.push({ pos: i === 0 ? hoist(doc, pos) : rowPos, ...b, kind: 'row', keepNext: false, keepLines: true, breakBefore: false })
        rowPos += row.nodeSize
      })
      return false
    }
    if (node.isTextblock) {
      const dom = view.nodeDOM(pos) as HTMLElement | null
      const b = box(dom)
      if (!b || !dom) return false
      const st = node.type.name === 'paragraph' || node.type.name === 'heading' ? styleFor(node) : {}
      const size = node.nodeSize
      units.push({
        pos: hoist(doc, pos),
        ...b,
        kind: 'text',
        keepNext: Boolean(node.attrs.keepNext || st.keepNext),
        keepLines: Boolean(node.attrs.keepLines || st.keepLines),
        breakBefore: Boolean(node.attrs.pageBreakBefore || st.pageBreakBefore),
        lines: () => measureLines(view, dom, pos, size, m, node.attrs.dir === 'rtl')
      })
      return false
    }
    if (name === 'pageBreak') {
      const b = box(view.nodeDOM(pos) as Element)
      if (b) units.push({ pos, ...b, kind: 'pagebreak', keepNext: false, keepLines: true, breakBefore: false })
      return false
    }
    if (node.isBlock && node.isAtom) {
      const b = box(view.nodeDOM(pos) as Element)
      if (b) units.push({ pos: hoist(doc, pos), ...b, kind: 'atom', keepNext: false, keepLines: true, breakBefore: false })
      return false
    }
    return true
  })
  return units
}

export function paginate(view: EditorView): Layout {
  return computeBreaks(measureUnits(view), metricsFor(pageOf(view.state.doc)))
}

// ---------- plugin ----------

export interface PaginationOptions {
  onLayout?: (state: PaginationState) => void
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
        const layout = paginate(view)
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
          view.dispatch(view.state.tr.setMeta(paginationKey, paginate(view)).setMeta('addToHistory', false))
          return true
        }
    }
  }
})
