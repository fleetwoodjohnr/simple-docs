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

/** Resume a previous layout from a page before the edit instead of recomputing everything. */
export interface Resume {
  /** Breaks kept unchanged (pages before the resume page). */
  prefix: Break[]
  /** Natural y where the resume page's content starts. */
  start: number
  /** The previous layout's breaks, positions already mapped to the current document. */
  prev: Break[]
  /** End of the edited range: old breaks may be reused only after it. */
  changeEnd: number
}

export interface Layout {
  breaks: Break[]
  pageCount: number
  /** Indexes of pages whose content overflows (a unit taller than a page). */
  overflow: number[]
  /** True when an incremental pass stopped early and reused the old tail. */
  reused?: boolean
}

const EPS = 0.5

export function computeBreaks(units: Unit[], m: PageMetrics, resume?: Resume): Layout {
  const breaks: Break[] = resume ? [...resume.prefix] : []
  const overflow: number[] = []
  const sep = m.noteSep ?? 12
  let start = resume ? resume.start : m.contentTop
  let reused = false
  /** Height of footnotes already placed on the current page. */
  let noteH = 0
  const area = (h: number) => (h > 0 ? h + sep : 0)
  const limitWith = (extra: number) => start + m.contentHeight - area(noteH + extra)
  /** Notes of `u` whose reference lies in [from, to) on the current page. */
  const notesIn = (u: Unit, from: number, to: number) => (u.notes ?? []).reduce((s, n) => (n.y >= from - EPS && n.y < to - EPS ? s + n.h : s), 0)

  /** Start a new page; returns true when the rest of the old layout was reused (stop). */
  const newPage = (pos: number, kind: BreakKind, s: number): boolean => {
    breaks.push({ pos, kind, start: s, height: m.stride - (s - start) })
    start = s
    noteH = 0
    // Past the edit, a page that starts where an old page started is followed by the same pages.
    if (resume && pos > resume.changeEnd) {
      const j = resume.prev.findIndex((b) => b.pos === pos && b.kind === kind)
      if (j >= 0) {
        const d = s - resume.prev[j].start
        for (const b of resume.prev.slice(j + 1)) breaks.push({ ...b, start: b.start + d })
        reused = true
        return true
      }
    }
    return false
  }
  const blockKind = (u: Unit): BreakKind => (u.kind === 'row' ? 'row' : 'block')

  let forced = false
  outer: for (let k = 0; k < units.length; k++) {
    const u = units[k]
    if (u.kind === 'pagebreak') {
      forced = true
      continue
    }
    if ((forced || u.breakBefore) && u.top > start + EPS && newPage(u.pos, blockKind(u), u.top)) break outer
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
            if (newPage(lines[s].pos, 'inline', lines[s].top)) break outer
            continue
          }
        }
      }
      // 2. Move the unit (and any keep-with-next chain ending at it) to the next page.
      let b = k
      while (b > 0 && units[b - 1].keepNext && units[b - 1].kind !== 'pagebreak' && units[b - 1].top > start + EPS) b--
      if (units[b].top > start + EPS) {
        if (newPage(units[b].pos, blockKind(units[b]), units[b].top)) break outer
        // Units between the chain start and k are re-placed on the new page.
        for (let j = b; j < k; j++) noteH += notesIn(units[j], start, Infinity)
        continue
      }
      // 3. Already at the top of a page: split anywhere we can, else let it overflow.
      if (u.kind === 'text' && u.lines) {
        const lines = u.lines()
        const s = lines.findIndex((l) => l.top > start + EPS && l.bottom > limitWith(notesIn(u, start, l.top)) + EPS)
        if (s > 0 && lines[s].pos > 0) {
          if (newPage(lines[s].pos, 'inline', lines[s].top)) break outer
          continue
        }
      }
      overflow.push(breaks.length)
      noteH += own
      break
    }
  }
  return { breaks, pageCount: breaks.length + 1, overflow, reused }
}

export function sameBreaks(a: Break[], b: Break[]): boolean {
  return a.length === b.length && a.every((x, i) => x.pos === b[i].pos && x.kind === b[i].kind && Math.abs(x.height - b[i].height) < 0.5)
}
