// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { chartFromTable, chartSvg, niceScale, shapeSvg, type ChartSpec } from '@/editor/drawing'

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml')

describe('charts', () => {
  const spec: ChartSpec = { kind: 'chart', type: 'column', title: 'Sales <2026> & "co"', categories: ['Q1', 'Q2', 'Q3'], series: [{ name: 'A', values: [10, 25, 17] }, { name: 'B', values: [5, -3, 12] }] }

  it('picks round axis bounds that include zero', () => {
    expect(niceScale(0, 87)).toEqual({ lo: 0, hi: 100, step: 20 })
    expect(niceScale(-3, 25)).toEqual({ lo: -10, hi: 30, step: 10 })
    expect(niceScale(0, 0).hi).toBeGreaterThan(0)
  })

  it('draws one bar per value, escapes text and produces well-formed SVG', () => {
    const doc = parse(chartSvg(spec))
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelectorAll('rect.bar')).toHaveLength(6)
    expect(doc.querySelector('text')!.textContent).toBe('Sales <2026> & "co"')
    // negative value is drawn below the zero line
    const bars = [...doc.querySelectorAll('rect.bar')]
    const zeroLine = doc.querySelectorAll('line')[doc.querySelectorAll('line').length - 1]
    const neg = bars[4]
    expect(Number(neg.getAttribute('y'))).toBeCloseTo(Number(zeroLine.getAttribute('y1')), 0)
  })

  it('line and pie charts', () => {
    const line = parse(chartSvg({ ...spec, type: 'line' }))
    expect(line.querySelectorAll('polyline')).toHaveLength(2)
    const pie = parse(chartSvg({ ...spec, type: 'pie', series: [{ name: 'A', values: [1, 1, 2] }] }))
    expect(pie.querySelectorAll('path')).toHaveLength(3)
    expect([...pie.querySelectorAll('text')].map((t) => t.textContent)).toContain('50%')
  })

  it('reads chart data from a table (CSV rows)', () => {
    expect(chartFromTable([['', 'Revenue', 'Costs'], ['Q1', '$1,200', '900'], ['Q2', '1500', '']])).toEqual({
      categories: ['Q1', 'Q2'],
      series: [
        { name: 'Revenue', values: [1200, 1500] },
        { name: 'Costs', values: [900, NaN] }
      ]
    })
  })
})

describe('shapes', () => {
  it('draws each shape with escaped text', () => {
    for (const shape of ['rect', 'rounded', 'ellipse', 'triangle', 'diamond', 'arrow', 'star', 'line'] as const) {
      const doc = parse(shapeSvg({ kind: 'shape', shape, fill: '#3f6fd8', stroke: 'none', text: 'a < b', textColor: '#ffffff', width: 200, height: 100 }))
      expect(doc.querySelector('parsererror')).toBeNull()
      if (shape !== 'line') expect(doc.querySelector('text')!.textContent).toBe('a < b')
    }
  })
  it('rejects colors that are not hex', () => {
    expect(shapeSvg({ kind: 'shape', shape: 'rect', fill: 'red" onload="x', stroke: 'none', text: '', textColor: '#fff', width: 10, height: 10 })).not.toContain('onload')
  })
})
