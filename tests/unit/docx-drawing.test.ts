import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { type ChartSpec, type DrawingSpec, type ShapeSpec, type ShapeType } from '@/editor/drawing'
import { exportDocx } from '@/formats/docx/write'
import { importDocx, type DocxCarry } from '@/formats/docx/read'
import { drawingPicture, shapeFromWsp } from '@/formats/docx/drawing'
import { parseXml } from '@/formats/docx/xml'
import { hasPoppler, soffice } from '../tools'

const chart = (type: ChartSpec['type'], title = 'Quarterly sales'): ChartSpec => ({
  kind: 'chart',
  type,
  title,
  categories: ['North', 'South & East', 'West'],
  series: type === 'pie' ? [{ name: 'Units', values: [5, 3, 2] }] : [{ name: '2025', values: [4, -1.5, 7] }, { name: '2026', values: [6, 2, NaN] }]
})
const shape = (s: ShapeType): ShapeSpec => ({ kind: 'shape', shape: s, fill: '#3f6fd8', stroke: s === 'rect' ? '#1c1c22' : 'none', text: s === 'line' ? '' : 'Step 1\nCheck <input>', textColor: '#ffffff', width: 200, height: 100 })
const docWith = (...drawings: DrawingSpec[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: drawings.map((d) => ({ type: 'image', attrs: { src: drawingPicture(d, 480, 288), drawing: d, width: d.kind === 'chart' ? 480 : d.width, height: d.kind === 'chart' ? 288 : d.height, alt: 'A drawing' } })) }]
})
const drawingsIn = (doc: JSONContent): JSONContent[] => (doc.type === 'image' ? [doc] : (doc.content ?? []).flatMap(drawingsIn))
const relIds = (files: Record<string, Uint8Array>) => [...strFromU8(files['word/_rels/document.xml.rels']).matchAll(/Id="([^"]+)"/g)].map((m) => m[1])

describe('native Word charts', () => {
  for (const type of ['column', 'bar', 'line', 'pie'] as const)
    it(`${type}: a DrawingML chart with cached data and an embedded workbook, read back as the same chart`, () => {
      const out = exportDocx(docWith(chart(type)))
      const files = unzipSync(out.data)
      const xml = strFromU8(files['word/charts/sd-chart1.xml'])
      expect(xml).toContain(type === 'pie' ? '<c:pieChart>' : type === 'line' ? '<c:lineChart>' : `<c:barDir val="${type === 'bar' ? 'bar' : 'col'}"/>`)
      expect(xml).toContain('<c:v>South &amp; East</c:v>')
      expect(strFromU8(files['word/document.xml'])).toContain('graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"')
      expect(strFromU8(files['word/charts/_rels/sd-chart1.xml.rels'])).toContain('Target="../embeddings/sd-chart1.xlsx"')
      expect(strFromU8(files['[Content_Types].xml'])).toContain('<Override PartName="/word/charts/sd-chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>')
      expect(Object.keys(files).some((p) => p.startsWith('word/media/'))).toBe(false) // not a picture
      const sheet = strFromU8(unzipSync(files['word/embeddings/sd-chart1.xlsx'])['xl/worksheets/sheet1.xml'])
      expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">South &amp; East</t></is></c>')
      expect(out.warnings).toEqual([])
      const [img] = drawingsIn(importDocx(out.data).doc)
      expect(img.attrs?.drawing).toEqual(chart(type))
      expect(img.attrs?.alt).toBe('A drawing')
      expect(String(img.attrs?.src)).toMatch(/^data:image\/svg\+xml;base64,/)
    })

  it('an unchanged chart goes back byte for byte; an edited one is regenerated and the old part dropped', () => {
    const first = importDocx(exportDocx(docWith(chart('column'), chart('pie', 'Share'))).data)
    const again = unzipSync(exportDocx(first.doc, first.carry as DocxCarry).data)
    const orig = unzipSync(exportDocx(docWith(chart('column'), chart('pie', 'Share'))).data)
    expect(strFromU8(again['word/charts/sd-chart1.xml'])).toBe(strFromU8(orig['word/charts/sd-chart1.xml']))
    expect(Object.keys(again).filter((p) => /^word\/charts\/[^/]+\.xml$/.test(p))).toHaveLength(2)

    const edited = structuredClone(first.doc)
    const [col] = drawingsIn(edited)
    col.attrs!.drawing = { ...chart('column'), title: 'Revised' }
    const out = exportDocx(edited, first.carry as DocxCarry)
    const files = unzipSync(out.data)
    const charts = Object.keys(files).filter((p) => /^word\/charts\/[^/]+\.xml$/.test(p))
    expect(charts).toHaveLength(2) // the replaced chart's old part is not carried along
    expect(Object.keys(files).filter((p) => p.startsWith('word/embeddings/'))).toHaveLength(2)
    expect(new Set(relIds(files)).size).toBe(relIds(files).length)
    expect(out.warnings.map((w) => w.message)).toContain('Charts and shapes you changed are saved with Simple Docs’ styling')
    const back = drawingsIn(importDocx(out.data).doc).map((n) => (n.attrs?.drawing as ChartSpec).title)
    expect(back).toEqual(['Revised', 'Share'])
  })

  it.skipIf(!soffice || !hasPoppler)('LibreOffice draws it as a chart (its labels are text in the PDF) and reads the workbook', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sd-chart-'))
    const file = path.join(dir, 'chart.docx')
    const out = exportDocx(docWith(chart('column')))
    writeFileSync(file, out.data)
    execFileSync(soffice!, ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, file], { timeout: 120_000 })
    const text = execFileSync('pdftotext', [path.join(dir, 'chart.pdf'), '-']).toString()
    for (const s of ['Quarterly sales', 'North', 'South & East', '2026']) expect(text).toContain(s)
    writeFileSync(path.join(dir, 'book.xlsx'), unzipSync(out.data)['word/embeddings/sd-chart1.xlsx'])
    execFileSync(soffice!, ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'csv', '--outdir', dir, path.join(dir, 'book.xlsx')], { timeout: 120_000 })
    expect(readFileSync(path.join(dir, 'book.csv'), 'utf8').trim().split(/\r?\n/)).toEqual([',2025,2026', 'North,4,6', 'South & East,-1.5,2', 'West,7,'])
  }, 240_000)
})

describe('native Word shapes', () => {
  for (const s of ['rect', 'rounded', 'ellipse', 'triangle', 'diamond', 'arrow', 'star', 'line'] as const)
    it(`${s}: a Word shape (with a picture fallback for old readers), read back as the same shape`, () => {
      const spec = shape(s)
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const doc = docWith(spec)
      drawingsIn(doc)[0].attrs!.src = png
      const out = exportDocx(doc)
      const xml = strFromU8(unzipSync(out.data)['word/document.xml'])
      expect(xml).toMatch(/<mc:AlternateContent><mc:Choice Requires="wps">.*<wps:wsp>.*<\/mc:Choice><mc:Fallback><w:drawing>.*<pic:pic/)
      if (s !== 'line') expect(xml).toContain('Check &lt;input&gt;</w:t>')
      const [img] = drawingsIn(importDocx(out.data).doc)
      expect(img.attrs?.drawing).toEqual(spec)
    })

  it('shapes styled by the theme (or with effects) stay preserved instead of being simplified', () => {
    const wsp = (spPr: string) =>
      parseXml(`<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${spPr}</wps:spPr><wps:bodyPr/></wps:wsp>`).documentElement
    expect(shapeFromWsp(wsp('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:noFill/></a:ln>'), 100, 50)).toMatchObject({ shape: 'rect', fill: '#ff0000', stroke: 'none' })
    expect(shapeFromWsp(wsp(''), 100, 50)).toBeNull() // colours from wps:style / the theme
    expect(shapeFromWsp(wsp('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln>'), 100, 50)).toBeNull()
    expect(shapeFromWsp(wsp('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst><a:outerShdw/></a:effectLst>'), 100, 50)).toBeNull()
  })
})

it('re-saving a file we wrote keeps relationship ids unique', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://a.example' } }] }, { type: 'image', attrs: { src: png, width: 10, height: 10 } }] }] }
  const first = importDocx(exportDocx(doc).data)
  const files = unzipSync(exportDocx(first.doc, first.carry as DocxCarry).data)
  expect(new Set(relIds(files)).size).toBe(relIds(files).length)
  expect(Object.keys(files).filter((p) => p.startsWith('word/media/'))).toHaveLength(1)
})
