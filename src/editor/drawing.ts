// Charts and shapes as SVG generated from a small spec. Inserted as images (rasterized, so every
// format and PDF viewer shows them) that keep their spec in the `drawing` attribute for re-editing.

export type ChartType = 'column' | 'bar' | 'line' | 'pie'
export interface ChartSpec {
  kind: 'chart'
  type: ChartType
  title: string
  categories: string[]
  series: { name: string; values: number[] }[]
}

export type ShapeType = 'rect' | 'rounded' | 'ellipse' | 'triangle' | 'diamond' | 'arrow' | 'star' | 'line'
export interface ShapeSpec {
  kind: 'shape'
  shape: ShapeType
  fill: string
  stroke: string
  text: string
  textColor: string
  width: number
  height: number
}

export type DrawingSpec = ChartSpec | ShapeSpec

/** Distinguishable on white, in this order (Okabe–Ito based). */
export const CHART_COLORS = ['#3f6fd8', '#e08a1e', '#2a9d74', '#c8453b', '#8a5cc7', '#4aa3c9', '#b5952f', '#6b6b78']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const FONT = `font-family="Carlito, Calibri, 'Liberation Sans', Arial, sans-serif"`
const color = (c: string, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(c) || c === 'none' ? c : fallback)

/** Round axis maximum up to 1, 2, 2.5 or 5 × 10^n and split into ticks. */
export function niceScale(min: number, max: number, ticks = 5): { lo: number; hi: number; step: number } {
  const lo0 = Math.min(0, min)
  const hi0 = Math.max(0, max) || 1
  const raw = (hi0 - lo0) / ticks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  return { lo: Math.floor(lo0 / step) * step, hi: Math.ceil(hi0 / step) * step, step }
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100))

export function chartSvg(c: ChartSpec, W = 600, H = 360): string {
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`]
  const top = c.title ? 44 : 18
  if (c.title) out.push(`<text x="${W / 2}" y="28" text-anchor="middle" font-size="17" font-weight="600" fill="#1c1c22">${esc(c.title)}</text>`)
  const series = c.series.filter((s) => s.values.length)
  // Legend along the bottom
  const legendH = series.length > 1 || c.type === 'pie' ? 30 : 0
  const legendItems = c.type === 'pie' ? c.categories : series.map((s) => s.name)
  if (legendH) {
    const widths = legendItems.map((n) => 22 + Math.min(n.length, 24) * 7 + 14)
    let x = Math.max(10, (W - widths.reduce((a, b) => a + b, 0)) / 2)
    legendItems.forEach((n, i) => {
      out.push(`<rect x="${x}" y="${H - 21}" width="12" height="12" rx="2" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/><text x="${x + 18}" y="${H - 11}" font-size="12" fill="#3a3a44">${esc(n.slice(0, 24))}</text>`)
      x += widths[i]
    })
  }
  if (c.type === 'pie') {
    const values = (series[0]?.values ?? []).map((v) => Math.max(0, v || 0))
    const total = values.reduce((a, b) => a + b, 0) || 1
    const cx = W / 2
    const cy = top + (H - top - legendH) / 2
    const r = Math.min(W, H - top - legendH) / 2 - 12
    let a0 = -Math.PI / 2
    values.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
      const fill = CHART_COLORS[i % CHART_COLORS.length]
      out.push(v >= total ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>` : `<path d="M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`)
      if (v / total >= 0.05) {
        const m = (a0 + a1) / 2
        out.push(`<text x="${(cx + r * 0.62 * Math.cos(m)).toFixed(1)}" y="${(cy + r * 0.62 * Math.sin(m) + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#ffffff">${Math.round((v / total) * 100)}%</text>`)
      }
      a0 = a1
    })
    out.push('</svg>')
    return out.join('')
  }
  const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)))
  const { lo, hi, step } = niceScale(Math.min(0, ...all), Math.max(0, ...all))
  const horizontal = c.type === 'bar'
  const left = horizontal ? 16 + Math.min(14, Math.max(...c.categories.map((s) => s.length), 1)) * 7 : 56
  const right = W - 20
  const bottom = H - legendH - 30
  const plotW = right - left
  const plotH = bottom - top
  const val = (v: number) => (horizontal ? left + ((v - lo) / (hi - lo)) * plotW : bottom - ((v - lo) / (hi - lo)) * plotH)
  // grid + value axis labels
  for (let t = lo; t <= hi + step / 2; t += step) {
    const p = val(t).toFixed(1)
    out.push(horizontal ? `<line x1="${p}" y1="${top}" x2="${p}" y2="${bottom}" stroke="#e4e4ea"/><text x="${p}" y="${bottom + 18}" text-anchor="middle" font-size="11" fill="#6b6b78">${fmt(t)}</text>` : `<line x1="${left}" y1="${p}" x2="${right}" y2="${p}" stroke="#e4e4ea"/><text x="${left - 8}" y="${Number(p) + 4}" text-anchor="end" font-size="11" fill="#6b6b78">${fmt(t)}</text>`)
  }
  const n = Math.max(1, c.categories.length)
  const band = (horizontal ? plotH : plotW) / n
  c.categories.forEach((cat, i) => {
    const mid = (horizontal ? top : left) + band * (i + 0.5)
    const label = esc(cat.length > 14 ? cat.slice(0, 13) + '…' : cat)
    out.push(horizontal ? `<text x="${left - 8}" y="${mid + 4}" text-anchor="end" font-size="11" fill="#3a3a44">${label}</text>` : `<text x="${mid}" y="${bottom + 18}" text-anchor="middle" font-size="11" fill="#3a3a44">${label}</text>`)
  })
  const zero = val(0)
  if (c.type === 'line') {
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => [left + band * (i + 0.5), val(v || 0)] as const)
      const col = CHART_COLORS[k % CHART_COLORS.length]
      out.push(`<polyline points="${pts.map((p) => p.map((q) => q.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>`)
      pts.forEach(([x, y]) => out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${col}"/>`))
    })
  } else {
    const groupW = band * 0.72
    const barW = groupW / Math.max(1, series.length)
    series.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (i >= n || !Number.isFinite(v)) return
        const start = (horizontal ? top : left) + band * i + (band - groupW) / 2 + barW * k
        const end = val(v)
        const [a, b] = [Math.min(zero, end), Math.abs(end - zero)]
        out.push(horizontal ? `<rect class="bar" x="${a.toFixed(1)}" y="${start.toFixed(1)}" width="${b.toFixed(1)}" height="${(barW - 2).toFixed(1)}" fill="${CHART_COLORS[k % CHART_COLORS.length]}" rx="2"/>` : `<rect class="bar" x="${start.toFixed(1)}" y="${a.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${b.toFixed(1)}" fill="${CHART_COLORS[k % CHART_COLORS.length]}" rx="2"/>`)
      })
    })
  }
  out.push(horizontal ? `<line x1="${zero}" y1="${top}" x2="${zero}" y2="${bottom}" stroke="#9a9aa6"/>` : `<line x1="${left}" y1="${zero}" x2="${right}" y2="${zero}" stroke="#9a9aa6"/>`)
  out.push('</svg>')
  return out.join('')
}

export function shapeSvg(s: ShapeSpec): string {
  const W = s.width
  const H = s.height
  const sw = s.stroke === 'none' ? 0 : 2
  const i = sw / 2 + 1
  const fill = color(s.fill, '#3f6fd8')
  const stroke = color(s.stroke, 'none')
  const attrs = `fill="${s.shape === 'line' ? 'none' : fill}" stroke="${s.shape === 'line' ? (stroke === 'none' ? fill : stroke) : stroke}" stroke-width="${s.shape === 'line' ? 3 : sw}" stroke-linejoin="round"`
  const pts = (p: [number, number][]) => `<polygon points="${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" ${attrs}/>`
  let body: string
  switch (s.shape) {
    case 'rect':
      body = `<rect x="${i}" y="${i}" width="${W - 2 * i}" height="${H - 2 * i}" ${attrs}/>`
      break
    case 'rounded':
      body = `<rect x="${i}" y="${i}" width="${W - 2 * i}" height="${H - 2 * i}" rx="${Math.min(W, H) * 0.18}" ${attrs}/>`
      break
    case 'ellipse':
      body = `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - i}" ry="${H / 2 - i}" ${attrs}/>`
      break
    case 'triangle':
      body = pts([[W / 2, i], [W - i, H - i], [i, H - i]])
      break
    case 'diamond':
      body = pts([[W / 2, i], [W - i, H / 2], [W / 2, H - i], [i, H / 2]])
      break
    case 'arrow': {
      const h = H * 0.32
      const head = Math.min(W * 0.4, H)
      body = pts([[i, H / 2 - h / 2], [W - head, H / 2 - h / 2], [W - head, i], [W - i, H / 2], [W - head, H - i], [W - head, H / 2 + h / 2], [i, H / 2 + h / 2]])
      break
    }
    case 'star': {
      const p: [number, number][] = []
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.4 : 1
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        p.push([W / 2 + (W / 2 - i) * r * Math.cos(a), H / 2 + (H / 2 - i) * r * Math.sin(a) + (H * 0.05)])
      }
      body = pts(p)
      break
    }
    case 'line':
      body = `<line x1="${i + 1}" y1="${H / 2}" x2="${W - i - 1}" y2="${H / 2}" ${attrs} stroke-linecap="round"/>`
      break
  }
  const lines = s.shape === 'line' ? [] : s.text.split('\n').filter((l, k, a) => l || a.length === 1).slice(0, 6)
  const size = Math.max(10, Math.min(20, H / (lines.length + 1.5)))
  const text = lines
    .map((l, k) => `<text x="${W / 2}" y="${(H / 2 + (k - (lines.length - 1) / 2) * size * 1.2 + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size.toFixed(1)}" fill="${color(s.textColor, '#ffffff')}">${esc(l)}</text>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>${body}${text}</svg>`
}

export const drawingSvg = (d: DrawingSpec) => (d.kind === 'chart' ? chartSvg(d) : shapeSvg(d))
export const drawingSize = (d: DrawingSpec) => (d.kind === 'chart' ? { width: 600, height: 360 } : { width: d.width, height: d.height })

/** Chart data from CSV-like text: first row = series names (first cell ignored), then one row per category. */
export function chartFromTable(rows: string[][]): Pick<ChartSpec, 'categories' | 'series'> {
  const [head = [], ...body] = rows.filter((r) => r.some((c) => c.trim()))
  const names = head.slice(1)
  return {
    categories: body.map((r) => r[0] ?? ''),
    series: names.map((name, k) => ({ name: name || `Series ${k + 1}`, values: body.map((r) => parseFloat(String(r[k + 1] ?? '').replace(/[^\d.eE+-]/g, ''))) }))
  }
}
