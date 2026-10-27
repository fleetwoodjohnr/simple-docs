import { useMemo, useState } from 'react'
import { CHART_COLORS, chartFromTable, chartSvg, drawingSize, drawingSvg, shapeSvg, type ChartSpec, type ChartType, type DrawingSpec, type ShapeSpec, type ShapeType } from '@/editor/drawing'
import { parseCsv } from '@/editor/mailmerge'
import { bodyEditor, set, toast } from '../state/store'
import { Btn, Field, Modal, Segmented, cx, inputCls } from '../ui'

const close = () => set({ dialog: null })

const SAMPLE = 'Quarter,Revenue,Costs\nQ1,120,90\nQ2,150,95\nQ3,170,110\nQ4,210,120'
const SHAPES: { id: ShapeType; label: string }[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'rounded', label: 'Rounded rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'star', label: 'Star' },
  { id: 'line', label: 'Line' }
]

/** Rasterize an SVG to a PNG data URL (3× for crisp print), so every format and viewer shows it. */
async function rasterize(svg: string, w: number, h: number, scale = 3): Promise<string> {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

/** Alt text that conveys the data, not just "chart". */
function altFor(d: DrawingSpec): string {
  if (d.kind === 'shape') return d.text.trim() ? `${SHAPES.find((s) => s.id === d.shape)?.label}: ${d.text.trim().replace(/\n/g, ' ')}` : SHAPES.find((s) => s.id === d.shape)!.label
  const kind = { column: 'Column chart', bar: 'Bar chart', line: 'Line chart', pie: 'Pie chart' }[d.type]
  const data = d.series.map((s) => `${s.name}: ${d.categories.map((c, i) => `${c} ${Number.isFinite(s.values[i]) ? s.values[i] : '–'}`).join(', ')}`).join('; ')
  return `${kind}${d.title ? ` “${d.title}”` : ''}. ${data}`.slice(0, 1000)
}

const tableToCsv = (c: ChartSpec) => [['', ...c.series.map((s) => s.name)], ...c.categories.map((cat, i) => [cat, ...c.series.map((s) => (Number.isFinite(s.values[i]) ? String(s.values[i]) : ''))])].map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n')

export function DrawingDialog({ mode, pos }: { mode: 'chart' | 'shape'; pos?: number }) {
  const editor = bodyEditor()
  const existing = pos != null ? (editor?.state.doc.nodeAt(pos)?.attrs.drawing as DrawingSpec | null) : null
  // Type and title live here; categories and series always come from the data text.
  const [chart, setChart] = useState<ChartSpec>(existing?.kind === 'chart' ? existing : { kind: 'chart', type: 'column', title: '', categories: [], series: [] })
  const [csv, setCsv] = useState(existing?.kind === 'chart' ? tableToCsv(existing) : SAMPLE)
  const [shape, setShape] = useState<ShapeSpec>(existing?.kind === 'shape' ? existing : { kind: 'shape', shape: 'rounded', fill: CHART_COLORS[0], stroke: 'none', text: '', textColor: '#ffffff', width: 220, height: 120 })
  const kind = existing?.kind ?? mode

  const spec: DrawingSpec = useMemo(() => {
    if (kind === 'shape') return shape
    const parsed = parseCsv(csv)
    return { ...chart, ...chartFromTable([parsed.fields, ...parsed.rows.map((r) => parsed.fields.map((f) => r[f]))]) }
  }, [kind, shape, chart, csv])
  const svg = useMemo(() => (spec.kind === 'chart' ? chartSvg(spec) : shapeSvg(spec)), [spec])

  if (!editor) return null
  const save = async () => {
    try {
      const { width, height } = drawingSize(spec)
      const src = await rasterize(drawingSvg(spec), width, height)
      const node = pos != null ? editor.state.doc.nodeAt(pos) : null
      const attrs = { src, alt: altFor(spec), drawing: spec, width: node?.attrs.width && node.attrs.drawing?.kind === spec.kind && spec.kind === 'chart' ? node.attrs.width : spec.kind === 'chart' ? 480 : width }
      close()
      if (node) editor.chain().focus().command(({ tr }) => (tr.setNodeMarkup(pos!, undefined, { ...node.attrs, ...attrs }), true)).run()
      else editor.chain().focus().insertContent({ type: 'image', attrs }).run()
    } catch (e) {
      toast(`Could not draw this ${spec.kind}: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={`${existing ? 'Edit' : 'Insert'} ${kind}`}
      width={760}
      footer={
        <>
          <Btn onClick={close}>Cancel</Btn>
          <Btn variant="primary" onClick={save} data-testid="drawing-save">
            {existing ? 'Update' : 'Insert'}
          </Btn>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="w-[300px] shrink-0 space-y-3">
          {kind === 'chart' ? (
            <>
              <Segmented label="Chart type" value={chart.type} onChange={(type: ChartType) => setChart({ ...chart, type })} options={(['column', 'bar', 'line', 'pie'] as ChartType[]).map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} />
              <Field label="Title">
                <input className={inputCls} value={chart.title} onChange={(e) => setChart({ ...chart, title: e.target.value })} />
              </Field>
              <Field label="Data" hint="First row: series names. Then one row per category. Paste from a spreadsheet (tabs) or type CSV.">
                <textarea aria-label="Chart data" className={cx(inputCls, 'h-40 resize-none py-1.5 font-mono text-[12px]')} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
              </Field>
            </>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Shape">
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={shape.shape === s.id}
                    aria-label={s.label}
                    title={s.label}
                    onClick={() => setShape({ ...shape, shape: s.id, height: s.id === 'line' ? 24 : shape.height < 40 ? 120 : shape.height })}
                    className={cx('flex h-12 items-center justify-center rounded-lg border p-1.5', shape.shape === s.id ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong')}
                    dangerouslySetInnerHTML={{ __html: shapeSvg({ ...shape, shape: s.id, text: '', width: 48, height: s.id === 'line' ? 12 : 30 }) }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Fill">
                  <input type="color" aria-label="Fill color" className="h-8 w-full cursor-pointer rounded-lg border border-border bg-panel" value={shape.fill} onChange={(e) => setShape({ ...shape, fill: e.target.value })} />
                </Field>
                <Field label="Outline">
                  <select aria-label="Outline" className={inputCls} value={shape.stroke === 'none' ? 'none' : 'dark'} onChange={(e) => setShape({ ...shape, stroke: e.target.value === 'none' ? 'none' : '#1c1c22' })}>
                    <option value="none">None</option>
                    <option value="dark">Dark</option>
                  </select>
                </Field>
                <Field label="Text color">
                  <input type="color" aria-label="Text color" className="h-8 w-full cursor-pointer rounded-lg border border-border bg-panel" value={shape.textColor} onChange={(e) => setShape({ ...shape, textColor: e.target.value })} />
                </Field>
              </div>
              {shape.shape !== 'line' && (
                <Field label="Text">
                  <textarea aria-label="Shape text" className={cx(inputCls, 'h-16 resize-none py-1.5')} value={shape.text} onChange={(e) => setShape({ ...shape, text: e.target.value })} />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Width (px)">
                  <input type="number" min={16} max={1200} className={inputCls} value={shape.width} onChange={(e) => setShape({ ...shape, width: Math.max(16, Math.min(1200, Number(e.target.value) || 16)) })} />
                </Field>
                <Field label="Height (px)">
                  <input type="number" min={8} max={1200} className={inputCls} value={shape.height} onChange={(e) => setShape({ ...shape, height: Math.max(8, Math.min(1200, Number(e.target.value) || 8)) })} />
                </Field>
              </div>
            </>
          )}
        </div>
        <div className="flex min-h-[300px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2 [&>svg]:h-auto [&>svg]:max-h-[360px] [&>svg]:max-w-full" data-testid="drawing-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </Modal>
  )
}
