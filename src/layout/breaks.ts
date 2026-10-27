// Pure page-breaking algorithm. Input: measured flow units in *natural* coordinates
// (px, as if no page spacers existed, relative to the editor root's top edge).
// Output: page breaks. No DOM access here, so it is unit-testable.

export interface Line {
  top: number
  bottom: number
  /** Document position of the first character on the line. */
  pos: number
}

export type UnitKind = 'text' | 'atom' | 'row' | 'pagebreak'

export interface Unit {
  /** Position where a spacer goes when the unit moves to the next page (already hoisted out of containers). */
  pos: number
  top: number
  bottom: number
  kind: UnitKind
  keepNext: boolean
  keepLines: boolean
  breakBefore: boolean
  widowControl?: boolean
  /** Lazily measured line boxes (text units only). */
  lines?: () => Line[]
  /** Footnotes referenced in this unit: natural y of the reference and the note's rendered height. */
  notes?: { y: number; h: number }[]
}

export interface PageMetrics {
  /** Height available for body content on one page (px). */
  contentHeight: number
  /** Distance between the tops of consecutive pages on screen: page height + gap (px). */
  stride: number
  /** Natural y where page 1's content begins (the root's padding-top = top margin). */
  contentTop: number
  /** Space taken by the footnote separator when a page has notes (px). */
  noteSep?: number
}

export type BreakKind = 'block' | 'inline' | 'row'

export interface Break {
  pos: number
  kind: BreakKind
  /** Natural y at which the new page's content starts. */
  start: number
  /** Spacer height that moves `start` to the next page's content top. */
  height: number
}

export interface Layout {
  breaks: Break[]
  pageCount: number
  /** Indexes of pages whose content overflows (a unit taller than a page). */
  overflow: number[]
}

const EPS = 0.5

export function computeBreaks(units: Unit[], m: PageMetrics): Layout {
  const breaks: Break[] = []
  const overflow: number[] = []
  const sep = m.noteSep ?? 12
  let start = m.contentTop
  /** Height of footnotes already placed on the current page. */
  let noteH = 0
  const area = (h: number) => (h > 0 ? h + sep : 0)
  const limitWith = (extra: number) => start + m.contentHeight - area(noteH + extra)
  /** Notes of `u` whose reference lies in [from, to) on the current page. */
  const notesIn = (u: Unit, from: number, to: number) => (u.notes ?? []).reduce((s, n) => (n.y >= from - EPS && n.y < to - EPS ? s + n.h : s), 0)

  const newPage = (pos: number, kind: BreakKind, s: number) => {
    breaks.push({ pos, kind, start: s, height: m.stride - (s - start) })
    start = s
    noteH = 0
  }
  const blockKind = (u: Unit): BreakKind => (u.kind === 'row' ? 'row' : 'block')

  let forced = false
  for (let k = 0; k < units.length; k++) {
    const u = units[k]
    if (u.kind === 'pagebreak') {
      forced = true
      continue
    }
    if ((forced || u.breakBefore) && u.top > start + EPS) newPage(u.pos, blockKind(u), u.top)
    forced = false

    for (;;) {
      const own = notesIn(u, start, Infinity)
      if (u.bottom <= limitWith(own) + EPS) {
        noteH += own
        break
      }
      // 1. Split a paragraph between lines, honouring widow/orphan control and the
      //    footnotes referenced on the lines that stay on this page.
      if (u.kind === 'text' && !u.keepLines && u.lines) {
        const lines = u.lines()
        const f = lines.findIndex((l) => l.top >= start - EPS)
        let s = -1
        if (f >= 0)
          for (let j = lines.length - 1; j > f; j--) {
            if (lines[j - 1].bottom <= limitWith(notesIn(u, start, lines[j].top)) + EPS) {
              s = j
              break
            }
          }
        if (s > 0) {
          const widows = u.widowControl === false ? 1 : 2
          const orphans = f === 0 && u.widowControl !== false ? 2 : 1
          if (lines.length - s < widows) s = lines.length - widows
          if (s - f >= orphans && lines[s].top > start + EPS && lines[s].pos > 0) {
            newPage(lines[s].pos, 'inline', lines[s].top)
            continue
          }
        }
      }
      // 2. Move the unit (and any keep-with-next chain ending at it) to the next page.
      let b = k
      while (b > 0 && units[b - 1].keepNext && units[b - 1].kind !== 'pagebreak' && units[b - 1].top > start + EPS) b--
      if (units[b].top > start + EPS) {
        newPage(units[b].pos, blockKind(units[b]), units[b].top)
        // Units between the chain start and k are re-placed on the new page.
        for (let j = b; j < k; j++) noteH += notesIn(units[j], start, Infinity)
        continue
      }
      // 3. Already at the top of a page: split anywhere we can, else let it overflow.
      if (u.kind === 'text' && u.lines) {
        const lines = u.lines()
        const s = lines.findIndex((l) => l.top > start + EPS && l.bottom > limitWith(notesIn(u, start, l.top)) + EPS)
        if (s > 0 && lines[s].pos > 0) {
          newPage(lines[s].pos, 'inline', lines[s].top)
          continue
        }
      }
      overflow.push(breaks.length)
      noteH += own
      break
    }
  }
  return { breaks, pageCount: breaks.length + 1, overflow }
}

export function sameBreaks(a: Break[], b: Break[]): boolean {
  return a.length === b.length && a.every((x, i) => x.pos === b[i].pos && x.kind === b[i].kind && Math.abs(x.height - b[i].height) < 0.5)
}
