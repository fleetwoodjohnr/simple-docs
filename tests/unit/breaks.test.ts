import { describe, expect, it } from 'vitest'
import { computeBreaks, type Line, type Unit } from '@/layout/breaks'

const M = { contentHeight: 100, stride: 160, contentTop: 20 }

/** Build stacked units of the given heights starting at contentTop. */
function stack(specs: Array<Partial<Unit> & { h: number; lineH?: number }>): Unit[] {
  let y = M.contentTop
  return specs.map((s, i) => {
    const top = y
    const bottom = y + s.h
    y = bottom
    const lineH = s.lineH
    const lines = lineH
      ? (): Line[] => Array.from({ length: Math.round(s.h / lineH) }, (_, j) => ({ top: top + j * lineH, bottom: top + (j + 1) * lineH, pos: i * 1000 + j }))
      : undefined
    return { pos: i * 1000, top, bottom, kind: s.kind ?? (lineH ? 'text' : 'atom'), keepNext: !!s.keepNext, keepLines: !!s.keepLines, breakBefore: !!s.breakBefore, lines, ...s } as Unit
  })
}

describe('computeBreaks', () => {
  it('keeps content that fits on one page', () => {
    expect(computeBreaks(stack([{ h: 40 }, { h: 50 }]), M).pageCount).toBe(1)
  })

  it('moves a monolithic block to the next page and sizes the spacer', () => {
    const r = computeBreaks(stack([{ h: 60 }, { h: 60 }]), M)
    expect(r.pageCount).toBe(2)
    expect(r.breaks[0]).toMatchObject({ pos: 1000, kind: 'block', start: 80 })
    // spacer moves y=80 to the next page content top (stride + contentTop = 180)
    expect(80 + r.breaks[0].height).toBe(180)
  })

  it('splits a paragraph between lines with widow/orphan control', () => {
    // 80px of other content, then a 10-line paragraph of 10px lines: 2 lines fit.
    const r = computeBreaks(stack([{ h: 80 }, { h: 100, lineH: 10 }]), M)
    expect(r.breaks[0]).toMatchObject({ kind: 'inline', pos: 1002, start: 120 })
  })

  it('does not leave a single orphan line', () => {
    // only one line would fit → whole paragraph moves
    const r = computeBreaks(stack([{ h: 90 }, { h: 50, lineH: 10 }]), M)
    expect(r.breaks[0]).toMatchObject({ kind: 'block', pos: 1000 })
  })

  it('does not leave a single widow line', () => {
    // 9 of 10 lines fit → pull one more line so 2 go to the next page
    const r = computeBreaks(stack([{ h: 10 }, { h: 100, lineH: 10 }]), M)
    expect(r.breaks[0]).toMatchObject({ kind: 'inline', pos: 1008 })
  })

  it('splits a long paragraph across several pages', () => {
    const r = computeBreaks(stack([{ h: 350, lineH: 10 }]), M)
    expect(r.pageCount).toBe(4)
    expect(r.breaks.every((b) => b.kind === 'inline')).toBe(true)
  })

  it('keeps a heading with the next paragraph', () => {
    const r = computeBreaks(stack([{ h: 70 }, { h: 20, keepNext: true, lineH: 20, keepLines: true }, { h: 30, keepLines: true, lineH: 10 }]), M)
    expect(r.breaks[0]).toMatchObject({ pos: 1000 })
  })

  it('honours forced page breaks', () => {
    const r = computeBreaks(stack([{ h: 10 }, { h: 2, kind: 'pagebreak' }, { h: 10 }]), M)
    expect(r.breaks).toHaveLength(1)
    expect(r.breaks[0]).toMatchObject({ pos: 2000, start: 32 })
  })

  it('records overflow for blocks taller than a page', () => {
    const r = computeBreaks(stack([{ h: 150 }, { h: 10 }]), M)
    expect(r.overflow).toEqual([0])
    expect(r.pageCount).toBe(2)
  })
})

describe('footnotes', () => {
  it('reserves room for a footnote on the page of its reference', () => {
    // 60px block, then a 30px block whose footnote is 20px tall (+12 separator): 60+30+32 > 100
    const units = stack([{ h: 60 }, { h: 30 }])
    units[1].notes = [{ y: units[1].top + 5, h: 20 }]
    const r = computeBreaks(units, M)
    expect(r.breaks[0]).toMatchObject({ pos: 1000 })
  })

  it('splits a paragraph so the reference line and its note share a page', () => {
    // 10-line paragraph (10px lines) with a 30px note referenced on line 2 → 100 - 42 = 58px of lines fit
    const units = stack([{ h: 100, lineH: 10 }])
    units[0].notes = [{ y: units[0].top + 15, h: 30 }]
    const r = computeBreaks(units, M)
    expect(r.breaks[0]).toMatchObject({ kind: 'inline', pos: 5 })
  })

  it('places notes without a break when everything fits', () => {
    const units = stack([{ h: 40 }, { h: 20 }])
    units[1].notes = [{ y: units[1].top, h: 10 }]
    expect(computeBreaks(units, M).pageCount).toBe(1)
  })
})

describe('incremental re-layout', () => {
  const doc = (heights: number[]) => stack(heights.map((h) => ({ h, lineH: 10 })))
  const heights = Array.from({ length: 60 }, (_, i) => 20 + ((i * 7) % 5) * 10)

  it('matches a full pass after an edit, and reuses the tail', () => {
    const before = computeBreaks(doc(heights), M)
    const edited = [...heights]
    edited[20] += 30 // a paragraph grows by three lines
    const full = computeBreaks(doc(edited), M)
    const k = Math.max(0, before.breaks.filter((b) => b.pos <= 20000).length - 1)
    const from = before.breaks[k - 1]
    const units = doc(edited).filter((u) => u.pos >= from.pos)
    const inc = computeBreaks(units, M, { prefix: before.breaks.slice(0, k), start: from.start, prev: before.breaks, changeEnd: 20000 })
    expect(inc.breaks.map((b) => [b.pos, b.kind, Math.round(b.height)])).toEqual(full.breaks.map((b) => [b.pos, b.kind, Math.round(b.height)]))
  })

  it('stops early when the old layout re-converges', () => {
    const before = computeBreaks(doc(heights), M)
    const edited = [...heights]
    edited[3] += 0 // no geometric change
    let measured = 0
    const units = doc(edited).map((u) => {
      const top = u.top
      const bottom = u.bottom
      return Object.defineProperties({ ...u }, { top: { get: () => (measured++, top) }, bottom: { get: () => bottom } }) as typeof u
    })
    const inc = computeBreaks(units, M, { prefix: [], start: M.contentTop, prev: before.breaks, changeEnd: 3000 })
    expect(inc.reused).toBe(true)
    expect(inc.breaks).toEqual(before.breaks)
    expect(measured).toBeLessThan(units.length)
  })
})
