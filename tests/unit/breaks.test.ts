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
