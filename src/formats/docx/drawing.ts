import { strToU8, zipSync } from 'fflate'
import { CHART_COLORS, chartSvg, shapeSvg, type ChartSpec, type ChartType, type DrawingSpec, type ShapeSpec, type ShapeType } from '@/editor/drawing'
import { NS, attr, child, children, elements, escXml as x, find, findAll, is, textOf, toBase64, wval, type El } from './xml'

// Charts and shapes as native Word objects: DrawingML charts (with an embedded workbook so Word's
// "Edit Data" works) and Word 2010 shapes (wps). The readers accept what the writers produce and the
// same constructs from Word or LibreOffice; anything richer returns null and stays preserved as-is.

export const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
export const CHART_URI = C_NS
export const WPS_URI = NS.wps
export const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
export const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
export const REL_PACKAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package'
const PX_TO_EMU = 9525

/** What a drawing looked like when it was read from a file: unchanged drawings are written back verbatim. */
export const drawingKey = (a: Record<string, unknown>) => JSON.stringify([a.drawing ?? null, a.width ?? null, a.height ?? null, a.float ?? null])

export const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${toBase64(strToU8(svg))}`

const hex = (c: string) => c.replace('#', '').toUpperCase()
const solid = (c: string) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`
/** Spreadsheet column name: 0 → A, 25 → Z, 26 → AA. */
const col = (i: number): string => (i >= 26 ? col(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))

// ---------- charts ----------

export function chartPartXml(c: ChartSpec): string {
  const n = Math.max(1, c.categories.length)
  const pie = c.type === 'pie'
  const series = (pie ? c.series.slice(0, 1) : c.series).map((s, k) => {
    const color = CHART_COLORS[k % CHART_COLORS.length]
    const tx = `<c:tx><c:strRef><c:f>Sheet1!$${col(k + 1)}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${x(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
    const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${c.categories.length}"/>${c.categories.map((v, i) => `<c:pt idx="${i}"><c:v>${x(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`
    const pts = s.values.map((v, i) => (Number.isFinite(v) && i < c.categories.length ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('')
    const val = `<c:val><c:numRef><c:f>Sheet1!$${col(k + 1)}$2:$${col(k + 1)}$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${c.categories.length}"/>${pts}</c:numCache></c:numRef></c:val>`
    const head = `<c:idx val="${k}"/><c:order val="${k}"/>${tx}`
    if (c.type === 'line')
      return `<c:ser>${head}<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${solid(color)}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`
    if (pie) {
      const dPt = c.categories.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solid(CHART_COLORS[i % CHART_COLORS.length])}<a:ln w="19050">${solid('#ffffff')}</a:ln></c:spPr></c:dPt>`).join('')
      const labels = `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1">${solid('#ffffff')}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`
      return `<c:ser>${head}${dPt}${labels}${cat}${val}</c:ser>`
    }
    return `<c:ser>${head}<c:spPr>${solid(color)}</c:spPr><c:invertIfNegative val="0"/>${cat}${val}</c:ser>`
  })
  const axIds = '<c:axId val="510001"/><c:axId val="510002"/>'
  const axes = (catPos: string, valPos: string, reverse: boolean) =>
    `<c:catAx><c:axId val="510001"/><c:scaling><c:orientation val="${reverse ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="510002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="510002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valPos}"/><c:majorGridlines><c:spPr><a:ln w="9525">${solid('#e4e4ea')}</a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="510001"/><c:crosses val="${reverse ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
  let plot: string
  if (pie) plot = `<c:pieChart><c:varyColors val="1"/>${series.join('')}<c:firstSliceAng val="0"/></c:pieChart>`
  else if (c.type === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.join('')}<c:marker val="1"/>${axIds}</c:lineChart>${axes('b', 'l', false)}`
  // Our bar chart lists the first category at the top: reversed category axis, values along the bottom.
  else plot = `<c:barChart><c:barDir val="${c.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series.join('')}<c:gapWidth val="40"/>${axIds}</c:barChart>${c.type === 'bar' ? axes('l', 'b', true) : axes('b', 'l', false)}`
  const title = c.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1300" b="1"/><a:t>${x(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>'
  const legend = pie || c.series.length > 1 ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
}

/** The chart's data as a one-sheet workbook (A1 empty, series names along row 1, categories down column A). */
export function chartWorkbook(c: ChartSpec): Uint8Array {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const cell = (ref: string, v: string | number) => (typeof v === 'number' ? (Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : '') : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`)
  const rows = [
    `<row r="1">${c.series.map((s, k) => cell(`${col(k + 1)}1`, s.name)).join('')}</row>`,
    ...c.categories.map((cat, i) => `<row r="${i + 2}">${cell(`A${i + 2}`, cat)}${c.series.map((s, k) => cell(`${col(k + 1)}${i + 2}`, s.values[i] ?? NaN)).join('')}</row>`)
  ]
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
  return zipSync({
    '[Content_Types].xml': strToU8(`${head}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`${head}<Relationships xmlns="${NS.rel}">${rel('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>`),
    'xl/workbook.xml': strToU8(`${head}<workbook xmlns="${S}" xmlns:r="${NS.r}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${head}<Relationships xmlns="${NS.rel}">${rel('rId1', 'worksheet', 'worksheets/sheet1.xml')}${rel('rId2', 'styles', 'styles.xml')}</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`${head}<worksheet xmlns="${S}"><sheetData>${rows.join('')}</sheetData></worksheet>`),
    'xl/styles.xml': strToU8(`${head}<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`)
  })
}

/** Points of a chart cache or literal, by index (missing points are undefined). */
function points(el: El | null): string[] {
  const data = el && (find(el, C_NS, 'strCache') ?? find(el, C_NS, 'numCache') ?? find(el, C_NS, 'strLit') ?? find(el, C_NS, 'numLit'))
  if (!data) return []
  const out: string[] = Array(Number(attr(child(data, C_NS, 'ptCount'), null, 'val') ?? 0)).fill('')
  for (const pt of children(data, C_NS, 'pt')) out[Number(attr(pt, null, 'idx'))] = textOf(child(pt, C_NS, 'v'))
  return out
}

/** A chart part as a ChartSpec, or null when it uses anything the chart editor can't represent. */
export function chartFromPart(doc: Document): ChartSpec | null {
  const chart = child(doc.documentElement, C_NS, 'chart')
  const plot = child(chart, C_NS, 'plotArea')
  const groups = elements(plot).filter((e) => e.localName.endsWith('Chart'))
  if (groups.length !== 1 || find(doc.documentElement, C_NS, 'multiLvlStrRef')) return null
  const g = groups[0]
  const v = (name: string) => attr(child(g, C_NS, name), null, 'val')
  let type: ChartType
  if (is(g, C_NS, 'barChart') && ['clustered', 'standard', null].includes(v('grouping'))) type = v('barDir') === 'bar' ? 'bar' : 'column'
  else if (is(g, C_NS, 'lineChart') && ['standard', null].includes(v('grouping'))) type = 'line'
  else if (is(g, C_NS, 'pieChart')) type = 'pie'
  else return null
  const sers = children(g, C_NS, 'ser').sort((a, b) => Number(attr(child(a, C_NS, 'order'), null, 'val')) - Number(attr(child(b, C_NS, 'order'), null, 'val')))
  if (!sers.length || (type === 'pie' && sers.length > 1)) return null
  const series = sers.map((s, k) => {
    const tx = child(s, C_NS, 'tx')
    return { name: (tx && (points(tx)[0] ?? textOf(child(tx, C_NS, 'v')))) || `Series ${k + 1}`, values: points(child(s, C_NS, 'val')).map((p) => (p === '' ? NaN : parseFloat(p))) }
  })
  const cats = points(child(sers[0], C_NS, 'cat'))
  const categories = cats.length ? cats : series[0].values.map((_, i) => String(i + 1))
  const titleEl = child(chart, C_NS, 'title')
  const rich = titleEl && find(titleEl, C_NS, 'rich')
  const deleted = attr(child(chart, C_NS, 'autoTitleDeleted'), null, 'val') === '1'
  // Word titles a one-series chart with the series name unless the title was deleted.
  const title = rich ? children(rich, NS.a, 'p').map((p) => findAll(p, NS.a, 't').map(textOf).join('')).join(' ') : titleEl ? (points(child(titleEl, C_NS, 'tx'))[0] ?? (series.length === 1 ? series[0].name : '')) : !deleted && series.length === 1 ? series[0].name : ''
  return { kind: 'chart', type, title, categories, series: series.map((s) => ({ ...s, values: categories.map((_, i) => s.values[i] ?? NaN) })) }
}

// ---------- shapes ----------

const PRST: Record<ShapeType, string> = { rect: 'rect', rounded: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', arrow: 'rightArrow', star: 'star5', line: 'line' }

/** Text lines and font size (pt) exactly as shapeSvg lays them out. */
function shapeText(s: ShapeSpec) {
  const lines = s.shape === 'line' ? [] : s.text.split('\n').filter((l, k, a) => l || a.length === 1).slice(0, 6)
  return { lines, pt: Math.max(10, Math.min(20, s.height / (lines.length + 1.5))) * 0.75 }
}

/** A wps:wsp graphic for a shape of cx × cy EMU. */
export function shapeGraphic(s: ShapeSpec, cx: number, cy: number): string {
  const line = s.shape === 'line'
  const min = Math.min(cx, cy)
  const adj =
    s.shape === 'rounded' ? '<a:gd name="adj" fmla="val 18000"/>' : s.shape === 'arrow' ? `<a:gd name="adj1" fmla="val 32000"/><a:gd name="adj2" fmla="val ${Math.round((Math.min(cx * 0.4, cy) / min) * 100000)}"/>` : ''
  const stroke = line ? (s.stroke === 'none' ? s.fill : s.stroke) : s.stroke
  const ln = stroke === 'none' ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${(line ? 3 : 2) * PX_TO_EMU}"${line ? ' cap="rnd"' : ''}>${solid(stroke)}<a:round/></a:ln>`
  const { lines, pt } = shapeText(s)
  const color = hex(/^#[0-9a-f]{6}$/i.test(s.textColor) ? s.textColor : '#ffffff')
  const txbx = lines.some(Boolean)
    ? `<wps:txbx><w:txbxContent>${lines
        .map((l) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${l ? `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="${color}"/><w:sz w:val="${Math.round(pt * 2)}"/><w:szCs w:val="${Math.round(pt * 2)}"/></w:rPr><w:t xml:space="preserve">${x(l)}</w:t></w:r>` : ''}</w:p>`)
        .join('')}</w:txbxContent></wps:txbx>`
    : ''
  return `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${WPS_URI}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${PRST[s.shape]}"><a:avLst>${adj}</a:avLst></a:prstGeom>${s.fill === 'none' ? '<a:noFill/>' : solid(s.fill)}${ln}</wps:spPr>${txbx}<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="45720" tIns="45720" rIns="45720" bIns="45720" anchor="ctr" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`
}

/** Explicit colour of a fill holder: '#rrggbb', 'none', or null when it is a theme/style colour or a gradient. */
function fillOf(el: El | null): string | null {
  if (!el) return null
  if (child(el, NS.a, 'noFill')) return 'none'
  const rgb = child(child(el, NS.a, 'solidFill'), NS.a, 'srgbClr')
  return rgb && !elements(rgb).length ? `#${(attr(rgb, null, 'val') ?? '').toLowerCase()}` : null
}

/** A wps:wsp as a ShapeSpec, or null when it uses anything beyond explicit colours, a preset outline and plain text. */
export function shapeFromWsp(wsp: El, widthPx: number, heightPx: number): ShapeSpec | null {
  const sp = child(wsp, NS.wps, 'spPr')
  const geom = attr(child(sp, NS.a, 'prstGeom'), null, 'prst')
  const shape = (Object.keys(PRST) as ShapeType[]).find((k) => PRST[k] === geom)
  const xfrm = child(sp, NS.a, 'xfrm')
  const extras = elements(sp).filter((e) => !['xfrm', 'prstGeom', 'solidFill', 'noFill', 'ln'].includes(e.localName))
  if (!shape || extras.length || (xfrm && (attr(xfrm, null, 'rot') || attr(xfrm, null, 'flipH') === '1' || attr(xfrm, null, 'flipV') === '1'))) return null
  const fill = fillOf(sp)
  const ln = child(sp, NS.a, 'ln')
  const stroke = fillOf(ln)
  if (!fill || !stroke) return null
  // Text: plain runs only (colour and size are ours to set; bold, fonts and the like would be lost).
  const paras = findAll(child(wsp, NS.wps, 'txbx'), NS.w, 'p')
  const runs = paras.flatMap((p) => children(p, NS.w, 'r'))
  const plain = runs.every((r) => elements(r).every((e) => ['rPr', 't'].includes(e.localName)) && elements(child(r, NS.w, 'rPr')).every((e) => ['rFonts', 'color', 'sz', 'szCs', 'lang'].includes(e.localName)))
  if (!plain || paras.some((p) => elements(p).some((e) => !['pPr', 'r', 'proofErr', 'bookmarkStart', 'bookmarkEnd'].includes(e.localName)))) return null
  const color = wval(find(runs[0] ?? null, NS.w, 'color'))
  return {
    kind: 'shape',
    shape,
    // A line is drawn with its outline colour, which the writer sets to the fill when there is no outline.
    fill: shape === 'line' && fill === 'none' ? stroke : fill,
    stroke: shape === 'line' && stroke === fill ? 'none' : stroke,
    text: paras.map((p) => findAll(p, NS.w, 't').map(textOf).join('')).join('\n'),
    textColor: color && /^[0-9a-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : '#ffffff',
    width: widthPx,
    height: heightPx
  }
}

/** The picture shown in the editor for a drawing read from a file. */
export const drawingPicture = (d: DrawingSpec, widthPx: number, heightPx: number) => svgDataUrl(d.kind === 'chart' ? chartSvg(d, widthPx, heightPx) : shapeSvg(d))
