import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// List numbering is computed here once and reused by the editor (decorations),
// print/PDF (cloned DOM keeps data-label) and exporters (DOCX/Markdown).

/** OrderedList `type` attr values: '1' | 'a' | 'A' | 'i' | 'I' | '1.1' (outline). null = by depth. */
export type ListType = '1' | 'a' | 'A' | 'i' | 'I' | '1.1'

const DEPTH_CYCLE: ListType[] = ['1', 'a', 'i']

export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n)
  const map: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ]
  let out = ''
  for (const [v, s] of map) while (n >= v) (out += s), (n -= v)
  return out
}

export function toAlpha(n: number): string {
  let out = ''
  while (n > 0) {
    n--
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out || 'a'
}

export function formatNumber(n: number, type: ListType): string {
  switch (type) {
    case 'a':
      return toAlpha(n)
    case 'A':
      return toAlpha(n).toUpperCase()
    case 'i':
      return toRoman(n)
    case 'I':
      return toRoman(n).toUpperCase()
    default:
      return String(n)
  }
}

export function effectiveListType(attrType: unknown, depth: number): ListType {
  return (['1', 'a', 'A', 'i', 'I', '1.1'] as const).includes(attrType as ListType) ? (attrType as ListType) : DEPTH_CYCLE[depth % 3]
}

export interface ListLabel {
  label: string
  /** Nesting depth of the containing list (0 = top level). */
  depth: number
  ordered: boolean
}

/** Map of listItem position → its rendered marker. */
export function computeListLabels(doc: PMNode): Map<number, ListLabel> {
  const out = new Map<number, ListLabel>()
  const walk = (node: PMNode, pos: number, depth: number, outline: number[]) => {
    node.forEach((child, offset) => {
      const childPos = pos + offset
      const name = child.type.name
      if (name === 'orderedList') {
        const type = effectiveListType(child.attrs.type, depth)
        const start = Number(child.attrs.start) || 1
        let i = 0
        child.forEach((item, itemOffset) => {
          const n = start + i++
          const nums = [...outline, n]
          const label = type === '1.1' ? nums.join('.') + '.' : formatNumber(n, type) + '.'
          const itemPos = childPos + 1 + itemOffset
          out.set(itemPos, { label, depth, ordered: true })
          walk(item, itemPos + 1, depth + 1, type === '1.1' ? nums : [])
        })
      } else if (name === 'bulletList' || name === 'taskList') {
        child.forEach((item, itemOffset) => {
          const itemPos = childPos + 1 + itemOffset
          if (name === 'bulletList') out.set(itemPos, { label: child.attrs.bullet ?? DEFAULT_BULLETS[depth % 3], depth, ordered: false })
          walk(item, itemPos + 1, depth + 1, [])
        })
      } else if (!child.isTextblock && !child.isAtom) {
        walk(child, childPos + 1, depth, outline)
      }
    })
  }
  walk(doc, 0, 0, [])
  return out
}

export const DEFAULT_BULLETS = ['•', '◦', '▪']

export const numberingKey = new PluginKey<DecorationSet>('numbering')

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  for (const [pos, l] of computeListLabels(doc)) {
    if (!l.ordered) continue
    const node = doc.nodeAt(pos)
    if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-label': l.label }))
  }
  return DecorationSet.create(doc, decos)
}

// ponytail: recomputes all labels on every doc change (O(n)); scope to changed lists if huge docs show it in profiles.
export function NumberingPlugin() {
  return new Plugin<DecorationSet>({
    key: numberingKey,
    state: {
      init: (_c, state) => decorate(state.doc),
      apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old)
    },
    props: {
      decorations: (state) => numberingKey.getState(state)
    }
  })
}

/** Rendered page number for a 0-based page index, honouring the document's numbering format/start. */
export function pageLabel(page: { numbering?: { format: '1' | 'i' | 'I' | 'a' | 'A'; start: number } } | null | undefined, pageIndex: number): string {
  const n = page?.numbering
  return formatNumber((n?.start ?? 1) + pageIndex, n?.format ?? '1')
}
