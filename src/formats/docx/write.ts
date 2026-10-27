import { zipSync, strToU8, strFromU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { makePageSetup, resolveStyle, defaultStyles, type DocMeta, type HeadersFooters, type PageSetup, type ParaProps, type RunProps, type StyleMap } from '@/editor/model'
import { effectiveListType, DEFAULT_BULLETS, type ListType } from '@/editor/numbering'
import { Warnings, type ExportResult } from '../types'
import { HIGHLIGHT_NAMES, type DocxCarry } from './read'
import type { CommentMap } from '@/editor/comments'
import { itemPropsXml, sourcesXml } from './sources'
import type { CitationStyle, SourceMap } from '@/editor/citations'
import { latexToOmml } from '@/editor/math/omml'
import { MERGE_NS, toCsv, type MergeData } from '@/editor/mailmerge'
import { drawingSize, type DrawingSpec } from '@/editor/drawing'
import { CHART_CT, CHART_URI, C_NS, REL_CHART, REL_PACKAGE, chartPartXml, chartWorkbook, drawingKey, shapeGraphic } from './drawing'
import { escXml as x, extFromMime, imageSize, parseDataUrl } from './xml'

// Editor JSON → DOCX. Element order inside pPr/rPr follows the OOXML schema
// sequence, which Word enforces.

const tw = (pt: number) => Math.round(pt * 20)
const PX_TO_EMU = 9525

const NSDECL =
  'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" mc:Ignorable="w14 w15 wp14"'

const REL = {
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  office: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties'
}

const CT = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
}

/** Parts this writer always regenerates (never copied from the carried original). */
const GENERATED = new Set(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml', 'docProps/app.xml'])

type Mark = { type: string; attrs?: Record<string, unknown> }

interface ListLevel {
  kind: 'bullet' | 'ordered'
  type: ListType
  bullet: string
}

class Writer {
  w = new Warnings()
  rels: { id: string; type: string; target: string; external?: boolean }[] = []
  /** Generated parts besides the main ones: images, charts and their workbooks. */
  media: Record<string, Uint8Array> = {}
  relSeq = 0
  drawingId = 1
  /** Relationship ids and part names of the original package (carried parts keep theirs). */
  taken: Set<string>
  /** Content types of generated parts that need an override. */
  partTypes: Record<string, string> = {}
  /** numId → levels (one abstractNum per list instance). */
  lists: { levels: ListLevel[]; start: number }[] = []
  contentWidthPx: number
  styles: StyleMap

  constructor(
    public page: PageSetup,
    styles: StyleMap,
    public carry: DocxCarry | null
  ) {
    this.contentWidthPx = ((page.width - page.margins.left - page.margins.right) * 96) / 72
    this.styles = styles
    this.taken = new Set([...(carry?.rels.map((r) => r.id) ?? []), ...Object.keys(carry?.parts ?? {})])
  }

  rel(type: string, target: string, external = false): string {
    let id: string
    do id = `sdR${++this.relSeq}`
    while (this.taken.has(id))
    this.rels.push({ id, type, target, external })
    return id
  }

  // ---------- run properties ----------
  rPr(marks: Mark[] = [], extraStyle?: string): string {
    const has = (t: string) => marks.some((m) => m.type === t)
    const ts = marks.find((m) => m.type === 'textStyle')?.attrs ?? {}
    const hl = marks.find((m) => m.type === 'highlight')?.attrs?.color as string | undefined
    const p: string[] = []
    if (extraStyle) p.push(`<w:rStyle w:val="${extraStyle}"/>`)
    const font = (ts.fontFamily as string | undefined) ?? (has('code') ? 'Courier New' : undefined)
    if (font) {
      const f = x(String(font).split(',')[0].replace(/["']/g, '').trim())
      p.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>`)
    }
    if (has('bold')) p.push('<w:b/><w:bCs/>')
    if (has('italic')) p.push('<w:i/><w:iCs/>')
    if (ts.caps) p.push('<w:caps/>')
    if (ts.smallCaps) p.push('<w:smallCaps/>')
    if (has('strike')) p.push('<w:strike/>')
    if (has('doubleStrike')) p.push('<w:dstrike/>')
    const color = cssColorHex(ts.color as string | undefined)
    if (color) p.push(`<w:color w:val="${color}"/>`)
    if (typeof ts.letterSpacing === 'number' && ts.letterSpacing) p.push(`<w:spacing w:val="${tw(ts.letterSpacing)}"/>`)
    const size = parseSizePt(ts.fontSize as string | undefined)
    if (size) p.push(`<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`)
    if (hl) {
      const hex = cssColorHex(hl)
      const named = Object.entries(HIGHLIGHT_NAMES).find(([, v]) => v.slice(1) === hex)?.[0]
      if (named) p.push(`<w:highlight w:val="${named}"/>`)
    }
    if (has('underline')) p.push('<w:u w:val="single"/>')
    if (hl) {
      const hex = cssColorHex(hl)
      if (hex && !Object.values(HIGHLIGHT_NAMES).some((v) => v.slice(1) === hex)) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`)
    }
    if (has('code')) p.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F5"/>')
    if (has('superscript')) p.push('<w:vertAlign w:val="superscript"/>')
    else if (has('subscript')) p.push('<w:vertAlign w:val="subscript"/>')
    return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : ''
  }

  // ---------- inline content ----------
  inline(nodes: JSONContent[] = []): string {
    let out = ''
    let i = 0
    while (i < nodes.length) {
      const n = nodes[i]
      const link = n.marks?.find((m) => m.type === 'link')
      if (link) {
        const href = String(link.attrs?.href ?? '')
        const group: JSONContent[] = []
        while (i < nodes.length && nodes[i].marks?.some((m) => m.type === 'link' && m.attrs?.href === href)) group.push(nodes[i++])
        const runs = group.map((g) => this.inlineNode(g, 'Hyperlink')).join('')
        if (href.startsWith('#')) out += `<w:hyperlink w:anchor="${x(href.slice(1))}" w:history="1">${runs}</w:hyperlink>`
        else if (/^(https?:|mailto:)/i.test(href)) out += `<w:hyperlink r:id="${this.rel(REL.hyperlink, href, true)}" w:history="1">${runs}</w:hyperlink>`
        else out += runs
        continue
      }
      out += this.inlineNode(n)
      i++
    }
    return out
  }

  inlineNode(n: JSONContent, charStyle?: string): string {
    switch (n.type) {
      case 'text': {
        const rpr = this.rPr(n.marks as Mark[], charStyle)
        const [pre, post] = this.commentMarkers(n)
        const del = n.marks?.find((m) => m.type === 'deletion')
        const ins = n.marks?.find((m) => m.type === 'insertion')
        const t = del ? 'w:delText' : 'w:t'
        let runs = (n.text ?? '')
          .split(/(\t)/)
          .filter(Boolean)
          .map((part) => (part === '\t' ? `<w:r>${rpr}<w:tab/></w:r>` : `<w:r>${rpr}<${t} xml:space="preserve">${x(part)}</${t}></w:r>`))
          .join('')
        const rev = del ?? ins
        if (rev) {
          const date = rev.attrs?.date && !isNaN(Date.parse(String(rev.attrs.date))) ? ` w:date="${new Date(String(rev.attrs.date)).toISOString().replace(/\.\d+Z$/, 'Z')}"` : ''
          const tag = del ? 'w:del' : 'w:ins'
          runs = `<${tag} w:id="${++this.revId}" w:author="${x(String(rev.attrs?.author || 'Author'))}"${date}>${runs}</${tag}>`
        }
        return pre + runs + post
      }
      case 'hardBreak':
        return '<w:r><w:br/></w:r>'
      case 'image':
        return this.image(n)
      case 'preservedInline':
        return this.preserved(n, false)
      case 'footnote': {
        const kind = n.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
        const id = this.notes[kind].length + 1
        const docRels = this.rels
        this.rels = this.noteRels[kind]
        const style = kind === 'footnote' ? 'FootnoteText' : 'EndnoteText'
        const refStyle = kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'
        let body = this.blocks(((n.attrs?.content as JSONContent[]) ?? []).length ? (n.attrs!.content as JSONContent[]) : [{ type: 'paragraph' }])
        this.rels = docRels
        // Style every note paragraph and put the note mark at the start of the first one.
        body = body.replace(/<w:p>(<w:pPr>(.*?)<\/w:pPr>)?/g, (_m, _pp, inner) => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${(inner ?? '').replace(/<w:pStyle [^>]*\/>/, '')}</w:pPr>`)
        body = body.replace(/(<w:p><w:pPr>.*?<\/w:pPr>)/, `$1<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${kind}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`)
        this.notes[kind].push(`<w:${kind} w:id="${id}">${body}</w:${kind}>`)
        this.usedNotes.add(kind)
        return `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${kind}Reference w:id="${id}"/></w:r>`
      }
      case 'equation': {
        const a = n.attrs ?? {}
        if (a.omml && a.latex === a.ommlLatex) return String(a.omml)
        const omml = latexToOmml(String(a.latex ?? ''), !!a.display)
        if (omml) return omml
        this.w.add('loss', 'Some equations use LaTeX that Word cannot represent; they are saved as linear text')
        return `<m:oMath><m:r><m:t xml:space="preserve">${x(String(a.latex ?? ''))}</m:t></m:r></m:oMath>`
      }
      case 'mergeField': {
        const name = String(n.attrs?.name ?? '')
        return `<w:fldSimple w:instr="${x(` MERGEFIELD ${/\s/.test(name) ? `"${name}"` : name} \\* MERGEFORMAT `)}"><w:r>${this.rPr(n.marks as Mark[])}<w:t>${x(`«${name}»`)}</w:t></w:r></w:fldSimple>`
      }
      case 'citation': {
        const a = n.attrs ?? {}
        const rpr = this.rPr(n.marks as Mark[])
        const r = (inner: string) => `<w:r>${rpr}${inner}</w:r>`
        const instr = ` CITATION ${a.source} \\l 1033 ${a.pages ? `\\p "${a.pages}" ` : ''}`
        return r('<w:fldChar w:fldCharType="begin"/>') + r(`<w:instrText xml:space="preserve">${x(instr)}</w:instrText>`) + r('<w:fldChar w:fldCharType="separate"/>') + r(`<w:t xml:space="preserve">${x(String(a.text ?? ''))}</w:t>`) + r('<w:fldChar w:fldCharType="end"/>')
      }
      case 'field': {
        const instr = ({ page: 'PAGE', pages: 'NUMPAGES', date: 'DATE \\@ "MMMM d, yyyy"', title: 'TITLE', author: 'AUTHOR' } as Record<string, string>)[String(n.attrs?.kind)] ?? 'PAGE'
        const rpr = this.rPr(n.marks as Mark[])
        const r = (inner: string) => `<w:r>${rpr}${inner}</w:r>`
        return r('<w:fldChar w:fldCharType="begin"/>') + r(`<w:instrText xml:space="preserve"> ${x(instr)} </w:instrText>`) + r('<w:fldChar w:fldCharType="separate"/>') + r('<w:t>1</w:t>') + r('<w:fldChar w:fldCharType="end"/>')
      }
      default:
        return ''
    }
  }

  image(n: JSONContent): string {
    const a = n.attrs ?? {}
    if (a.drawing) return this.drawing(a, a.drawing as DrawingSpec)
    const pic = this.picture(a)
    return pic && `<w:r>${pic}</w:r>`
  }

  /** Size in EMU: the given size (or natural size), scaled down to the text width. */
  extent(a: Record<string, unknown>, natural: { width: number; height: number }): [number, number] {
    let w = Number(a.width) || natural.width
    let h = Number(a.height) || (natural.height * w) / natural.width
    if (w > this.contentWidthPx) {
      h = (h * this.contentWidthPx) / w
      w = this.contentWidthPx
    }
    return [Math.round(w * PX_TO_EMU), Math.round(h * PX_TO_EMU)]
  }

  /** A w:drawing holding a graphic, inline or floating (square wrap) as the node says. */
  frame(a: Record<string, unknown>, [cx, cy]: [number, number], name: string, graphic: (id: number) => string, lockAspect = false): string {
    const id = this.drawingId++
    const descr = a.alt ? ` descr="${x(String(a.alt))}"` : ''
    const title = a.title ? ` title="${x(String(a.title))}"` : ''
    const docPr = `<wp:docPr id="${id}" name="${name} ${id}"${descr}${title}/><wp:cNvGraphicFramePr>${lockAspect ? '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>' : ''}</wp:cNvGraphicFramePr>`
    if (a.float === 'left' || a.float === 'right') {
      return `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${a.float}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${docPr}${graphic(id)}</wp:anchor></w:drawing>`
    }
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}${graphic(id)}</wp:inline></w:drawing>`
  }

  /** A picture's w:drawing ('' when the image can't be embedded). */
  picture(a: Record<string, unknown>): string {
    const parsed = parseDataUrl(String(a.src ?? ''))
    if (!parsed) {
      this.w.add('loss', 'Linked (non-embedded) images were left out')
      return ''
    }
    const ext = extFromMime(parsed.mime)
    if (ext === 'bin' || ext === 'svg') {
      this.w.add('loss', 'An image in an unsupported format was left out')
      return ''
    }
    const name = this.partName('word/media/sd-image', ext === 'jpeg' ? 'jpg' : ext)
    this.media[name] = parsed.bytes
    const rid = this.rel(REL.image, name.replace('word/', ''))
    const ext2 = this.extent(a, imageSize(parsed.bytes) ?? { width: 300, height: 200 })
    const descr = a.alt ? ` descr="${x(String(a.alt))}"` : ''
    return this.frame(a, ext2, 'Picture', (id) => `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"${descr}/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${ext2[0]}" cy="${ext2[1]}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`, true)
  }

  /** Charts and shapes as native Word objects; unchanged ones read from a file go back as they were. */
  drawing(a: Record<string, unknown>, d: DrawingSpec): string {
    const origin = a.origin as { xml: string; key: string } | null
    if (origin?.key === drawingKey(a) && this.rawOk(origin.xml)) return origin.xml
    if (origin) this.w.add('info', 'Charts and shapes you changed are saved with Simple Docs’ styling')
    const size = this.extent(a, drawingSize(d))
    if (d.kind === 'chart') {
      const part = this.partName('word/charts/sd-chart', 'xml')
      const book = this.partName('word/embeddings/sd-chart', 'xlsx')
      this.media[part] = strToU8(chartPartXml(d))
      this.media[book] = chartWorkbook(d)
      this.media[part.replace(/([^/]+)$/, '_rels/$1.rels')] = strToU8(relationshipsXml([{ id: 'rId1', type: REL_PACKAGE, target: `../embeddings/${book.split('/').pop()}` }]))
      this.partTypes[part] = CHART_CT
      const rid = this.rel(REL_CHART, part.replace('word/', ''))
      return `<w:r>${this.frame(a, size, 'Chart', () => `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="${CHART_URI}"><c:chart xmlns:c="${C_NS}" r:id="${rid}"/></a:graphicData></a:graphic>`)}</w:r>`
    }
    // Word 2010+, LibreOffice and Google Docs read the shape; older readers get the picture.
    const choice = this.frame(a, size, 'Shape', () => shapeGraphic(d, size[0], size[1]))
    const raster = /^data:image\/(png|jpe?g)/.test(String(a.src ?? '')) ? this.picture(a) : ''
    return `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${choice}</mc:Choice>${raster ? `<mc:Fallback>${raster}</mc:Fallback>` : ''}</mc:AlternateContent></w:r>`
  }

  /** A part name that neither the original package nor this writer uses yet. */
  partName(prefix: string, ext: string): string {
    let k = 0
    let name: string
    do name = `${prefix}${++k}.${ext}`
    while (this.taken.has(name) || this.media[name])
    return name
  }

  // ---------- paragraphs ----------
  pPr(a: Record<string, unknown>, opts: { style?: string | null; num?: { id: number; ilvl: number }; extra?: string; listIndent?: number } = {}): string {
    const p: string[] = []
    if (opts.style) p.push(`<w:pStyle w:val="${x(opts.style)}"/>`)
    if (a.keepNext) p.push('<w:keepNext/>')
    if (a.keepLines) p.push('<w:keepLines/>')
    if (a.pageBreakBefore) p.push('<w:pageBreakBefore/>')
    if (opts.num) p.push(`<w:numPr><w:ilvl w:val="${opts.num.ilvl}"/><w:numId w:val="${opts.num.id}"/></w:numPr>`)
    if (opts.extra) p.push(opts.extra)
    const shading = cssColorHex(a.shading as string | undefined)
    if (shading) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>`)
    if (a.dir === 'rtl') p.push('<w:bidi/>')
    const sp: string[] = []
    if (a.spaceBefore != null) sp.push(`w:before="${tw(Number(a.spaceBefore))}"`)
    if (a.spaceAfter != null) sp.push(`w:after="${tw(Number(a.spaceAfter))}"`)
    if (a.lineHeight != null) sp.push(`w:line="${Math.round(Number(a.lineHeight) * 240)}" w:lineRule="auto"`)
    if (sp.length) p.push(`<w:spacing ${sp.join(' ')}/>`)
    const ind: string[] = []
    if (opts.listIndent != null) ind.push(`w:left="${tw(opts.listIndent)}" w:hanging="${tw(18)}"`)
    else {
      if (a.indentLeft != null) ind.push(`w:left="${tw(Number(a.indentLeft))}"`)
      if (a.indentFirst != null) ind.push(Number(a.indentFirst) < 0 ? `w:hanging="${tw(-Number(a.indentFirst))}"` : `w:firstLine="${tw(Number(a.indentFirst))}"`)
    }
    if (a.indentRight != null) ind.push(`w:right="${tw(Number(a.indentRight))}"`)
    if (ind.length) p.push(`<w:ind ${ind.join(' ')}/>`)
    if (a.align) p.push(`<w:jc w:val="${a.align === 'justify' ? 'both' : a.align}"/>`)
    return p.length ? `<w:pPr>${p.join('')}</w:pPr>` : ''
  }

  paragraph(n: JSONContent, opts: Parameters<Writer['pPr']>[1] = {}): string {
    const a = n.attrs ?? {}
    let style = opts.style ?? null
    if (n.type === 'heading') style = (a.styleId as string) ?? `Heading${Math.min(9, Number(a.level) || 1)}`
    else if (!style && a.styleId) style = String(a.styleId)
    return `<w:p>${this.pPr(a, { ...opts, style })}${this.inline(n.content)}</w:p>`
  }

  // ---------- blocks ----------
  blocks(nodes: JSONContent[] = [], ctx: { quote?: boolean } = {}): string {
    return nodes.map((n) => this.block(n, ctx)).join('')
  }

  block(n: JSONContent, ctx: { quote?: boolean }): string {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        return this.paragraph(n, ctx.quote && !n.attrs?.styleId && n.type === 'paragraph' ? { style: 'Quote' } : {})
      case 'bulletList':
      case 'orderedList':
        return this.list(n)
      case 'taskList':
        return this.taskList(n, 0)
      case 'blockquote':
        return this.blocks(n.content, { quote: true })
      case 'codeBlock': {
        this.usedCode = true
        const lines = (n.content ?? []).map((t) => t.text ?? '').join('').split('\n')
        return lines.map((l) => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${l ? this.inlineNode({ type: 'text', text: l }) : ''}</w:p>`).join('')
      }
      case 'horizontalRule':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C8C8D0"/></w:pBdr></w:pPr></w:p>'
      case 'pageBreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      case 'sectionBreak': {
        const a = n.attrs ?? {}
        if (a.format === 'docx' && a.raw) return `<w:p><w:pPr>${a.raw}</w:pPr></w:p>`
        // A section that inherits the document's page setup.
        return `<w:p><w:pPr>${this.sectPr(null).replace('<w:sectPr>', `<w:sectPr><w:type w:val="${a.kind ?? 'nextPage'}"/>`)}</w:pPr></w:p>`
      }
      case 'table':
        return this.table(n)
      case 'toc':
        return this.toc(n)
      case 'preservedBlock':
        return this.preserved(n, true)
      default:
        return n.content ? this.blocks(n.content, ctx) : ''
    }
  }
  usedCode = false
  revId = 1000
  tocLevels = new Set<number>()

  // ----- comments -----
  /** For each thread: Word ids (thread + replies) and the first/last text nodes it covers. */
  commentSpans = new Map<string, { ids: number[]; first: JSONContent; last: JSONContent }>()
  comments: CommentMap = {}

  prepareComments(doc: JSONContent) {
    this.comments = (doc.attrs?.comments as CommentMap | null) ?? {}
    let next = 0
    const walk = (n: JSONContent) => {
      if (n.type === 'text')
        for (const m of n.marks ?? []) {
          const id = m.attrs?.id as string
          if (m.type !== 'comment' || !this.comments[id]) continue
          const span = this.commentSpans.get(id)
          if (span) span.last = n
          else this.commentSpans.set(id, { ids: Array.from({ length: 1 + this.comments[id].replies.length }, () => next++), first: n, last: n })
        }
      n.content?.forEach(walk)
    }
    walk(doc)
  }

  commentMarkers(n: JSONContent): [string, string] {
    let pre = ''
    let post = ''
    for (const span of this.commentSpans.values()) {
      if (span.first === n) pre += span.ids.map((i) => `<w:commentRangeStart w:id="${i}"/>`).join('')
      if (span.last === n) post += span.ids.map((i) => `<w:commentRangeEnd w:id="${i}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${i}"/></w:r>`).join('')
    }
    return [pre, post]
  }

  commentsXml(): { comments: string; extended: string } | null {
    if (!this.commentSpans.size) return null
    const paraId = (i: number) => (0x10000000 + i).toString(16).toUpperCase()
    const initials = (a: string) => x(a.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 3))
    const one = (id: number, c: { author: string; date: string; text: string }) => {
      const lines = (c.text || ' ').split('\n')
      const paras = lines.map((l, i) => {
        const ref = i === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''
        const pid = i === lines.length - 1 ? ` w14:paraId="${paraId(id)}" w14:textId="77777777"` : ''
        return `<w:p${pid}><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${ref}<w:r><w:t xml:space="preserve">${x(l)}</w:t></w:r></w:p>`
      })
      const date = c.date && !isNaN(Date.parse(c.date)) ? ` w:date="${new Date(c.date).toISOString().replace(/\.\d+Z$/, 'Z')}"` : ''
      return `<w:comment w:id="${id}" w:author="${x(c.author)}"${date} w:initials="${initials(c.author)}">${paras.join('')}</w:comment>`
    }
    let comments = ''
    let extended = ''
    for (const [tid, span] of this.commentSpans) {
      const t = this.comments[tid]
      comments += one(span.ids[0], t)
      extended += `<w15:commentEx w15:paraId="${paraId(span.ids[0])}" w15:done="${t.resolved ? 1 : 0}"/>`
      t.replies.forEach((r, i) => {
        comments += one(span.ids[i + 1], r)
        extended += `<w15:commentEx w15:paraId="${paraId(span.ids[i + 1])}" w15:paraIdParent="${paraId(span.ids[0])}" w15:done="${t.resolved ? 1 : 0}"/>`
      })
    }
    return {
      comments: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${NSDECL}>${comments}</w:comments>`,
      extended: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">${extended}</w15:commentsEx>`
    }
  }
  notes = { footnote: [] as string[], endnote: [] as string[] }
  noteRels = { footnote: [] as Writer['rels'], endnote: [] as Writer['rels'] }
  usedNotes = new Set<'footnote' | 'endnote'>()

  notesPart(kind: 'footnote' | 'endnote'): string {
    const sep = (type: string, id: number, el: string) => `<w:${kind} w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${el}/></w:r></w:p></w:${kind}>`
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${kind}s ${NSDECL}>${sep('separator', -1, 'separator')}${sep('continuationSeparator', 0, 'continuationSeparator')}${this.notes[kind].join('')}</w:${kind}s>`
  }

  /** TOC as Word's content control + TOC field, with the current entries as the cached result. */
  toc(n: JSONContent): string {
    const entries = n.content ?? []
    const max = Number(n.attrs?.maxLevel) || 3
    const right = Math.round(this.contentWidthPx * 15)
    const paras = entries.map((e, i) => {
      const level = Math.min(9, Number(e.attrs?.level) || 1)
      this.tocLevels.add(level)
      const begin = i === 0 ? `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${max}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` : ''
      const end = i === entries.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : ''
      return `<w:p><w:pPr><w:pStyle w:val="TOC${level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${right}"/></w:tabs></w:pPr>${begin}${this.inline(e.content)}<w:r><w:tab/></w:r><w:r><w:t>${x(String(e.attrs?.page ?? ''))}</w:t></w:r>${end}</w:p>`
    })
    return `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${paras.join('')}</w:sdtContent></w:sdt>`
  }

  /** Raw XML is written back only when every part it references travels with the document. */
  rawOk(raw: string): boolean {
    const rels = new Set(this.carry?.rels.map((r) => r.id) ?? [])
    return (
      !!raw &&
      !!this.carry &&
      [...raw.matchAll(/\br:(?:id|embed|link|dm|lo|qs|cs)="([^"]+)"/g)].every((m) => rels.has(m[1])) &&
      (!raw.includes('footnoteReference') || !!this.carry.parts['word/footnotes.xml']) &&
      (!raw.includes('endnoteReference') || !!this.carry.parts['word/endnotes.xml'])
    )
  }

  preserved(n: JSONContent, block: boolean): string {
    const raw = String(n.attrs?.raw ?? '')
    if (n.attrs?.format === 'docx' && this.rawOk(raw)) return raw
    this.w.add('loss', `${n.attrs?.label ?? 'Preserved content'} could not be written back and was saved as plain text`)
    const run = `<w:r><w:t xml:space="preserve">${x(String(n.attrs?.text ?? ''))}</w:t></w:r>`
    return block ? `<w:p>${run}</w:p>` : run
  }

  /** Flatten a nested list into numbered paragraphs sharing one w:num. */
  list(n: JSONContent): string {
    const levels: ListLevel[] = []
    const numId = this.lists.length + 1
    const entry = { levels, start: Number(n.attrs?.start) || 1 }
    this.lists.push(entry)
    const out: string[] = []
    const walk = (list: JSONContent, ilvl: number) => {
      if (!levels[ilvl]) {
        levels[ilvl] = {
          kind: list.type === 'orderedList' ? 'ordered' : 'bullet',
          type: effectiveListType(list.attrs?.type, ilvl),
          bullet: (list.attrs?.bullet as string) ?? DEFAULT_BULLETS[ilvl % 3]
        }
      } else if ((levels[ilvl].kind === 'ordered') !== (list.type === 'orderedList')) this.w.add('info', 'Mixed bullet/number lists at the same level use the first list’s style')
      for (const item of list.content ?? []) {
        ;(item.content ?? []).forEach((child, i) => {
          if (child.type === 'bulletList' || child.type === 'orderedList') walk(child, Math.min(8, ilvl + 1))
          else if (child.type === 'paragraph' || child.type === 'heading')
            out.push(i === 0 ? this.paragraph(child, { style: 'ListParagraph', num: { id: numId, ilvl } }) : this.paragraph(child, { style: 'ListParagraph', listIndent: 36 * (ilvl + 1) }))
          else out.push(this.block(child, {}))
        })
      }
    }
    walk(n, 0)
    return out.join('')
  }

  taskList(n: JSONContent, depth: number): string {
    return (n.content ?? [])
      .map((item) =>
        (item.content ?? [])
          .map((child, i) => {
            if (child.type === 'taskList') return this.taskList(child, depth + 1)
            if (i > 0 || (child.type !== 'paragraph' && child.type !== 'heading')) return this.block(child, {})
            const checked = !!item.attrs?.checked
            const box = `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic" w:eastAsia="MS Gothic"/></w:rPr><w:t>${checked ? '☒' : '☐'}</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> </w:t></w:r>`
            return `<w:p>${this.pPr(child.attrs ?? {}, { listIndent: 18 * (depth + 1) })}${box}${this.inline(child.content)}</w:p>`
          })
          .join('')
      )
      .join('')
  }

  table(n: JSONContent): string {
    const rows = n.content ?? []
    // Build the grid: track rowspans to emit vMerge continuation cells.
    const carry: { col: number; span: number; left: number; cell: JSONContent }[] = []
    const gridRows: { cells: { cell: JSONContent | null; col: number; span: number; cont: boolean }[]; header: boolean }[] = []
    let width = 0
    rows.forEach((row) => {
      const cells: { cell: JSONContent | null; col: number; span: number; cont: boolean }[] = []
      let col = 0
      const take = () => {
        let again = true
        while (again) {
          again = false
          for (const c of carry) if (c.left > 0 && c.col === col) {
            cells.push({ cell: c.cell, col, span: c.span, cont: true })
            c.left--
            col += c.span
            again = true
          }
        }
      }
      for (const cell of row.content ?? []) {
        take()
        const span = Number(cell.attrs?.colspan) || 1
        const rs = Number(cell.attrs?.rowspan) || 1
        cells.push({ cell, col, span, cont: false })
        if (rs > 1) carry.push({ col, span, left: rs - 1, cell })
        col += span
      }
      take()
      width = Math.max(width, col)
      gridRows.push({ cells, header: (row.content ?? []).every((c) => c.type === 'tableHeader') })
    })
    // Column widths from colwidth attrs, else even split of the text width.
    const widths: number[] = Array.from({ length: width }, () => 0)
    for (const r of gridRows) for (const c of r.cells) if (!c.cont && c.cell?.attrs?.colwidth && c.span === (c.cell.attrs.colwidth as number[]).length) (c.cell.attrs.colwidth as number[]).forEach((wpx, k) => (widths[c.col + k] ||= wpx))
    const known = widths.reduce((s, v) => s + v, 0)
    const unknown = widths.filter((v) => !v).length
    const rest = Math.max(40, (this.contentWidthPx - known) / Math.max(1, unknown))
    const colPx = widths.map((v) => v || rest)
    const twips = colPx.map((px) => Math.round(px * 15))
    const total = twips.reduce((s, v) => s + v, 0)
    const style = n.attrs?.tableStyle as string | null | undefined
    const line = (side: string, on: boolean, color = 'B9B9C3') => (on ? `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${color}"/>` : `<w:${side} w:val="nil"/>`)
    const plain = style === 'plain'
    const lines = style === 'lines'
    const c = style === 'striped' ? 'E3E3EA' : 'B9B9C3'
    const border = line('top', !plain, c) + line('left', !plain && !lines, c) + line('bottom', !plain, c) + line('right', !plain && !lines, c) + line('insideH', !plain, c) + line('insideV', !plain && !lines, c)
    let xml = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${twips.map((t) => `<w:gridCol w:w="${t}"/>`).join('')}</w:tblGrid>`
    for (const r of gridRows) {
      xml += `<w:tr>${r.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`
      for (const c of r.cells) {
        const a = c.cell?.attrs ?? {}
        const wTw = twips.slice(c.col, c.col + c.span).reduce((s, v) => s + v, 0)
        const pr: string[] = [`<w:tcW w:w="${wTw}" w:type="dxa"/>`]
        if (c.span > 1) pr.push(`<w:gridSpan w:val="${c.span}"/>`)
        if (c.cont) pr.push('<w:vMerge/>')
        else if ((Number(a.rowspan) || 1) > 1) pr.push('<w:vMerge w:val="restart"/>')
        const bg = cssColorHex(a.background as string | undefined) ?? (style === 'striped' && !r.header && gridRows.indexOf(r) % 2 === 1 ? 'F5F6FA' : null)
        if (bg) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>`)
        if (a.verticalAlign) pr.push(`<w:vAlign w:val="${a.verticalAlign === 'middle' ? 'center' : a.verticalAlign}"/>`)
        let body = c.cont ? '' : this.blocks(c.cell?.content)
        if (!body.trimEnd().endsWith('</w:p>')) body += '<w:p/>'
        xml += `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${body}</w:tc>`
      }
      xml += '</w:tr>'
    }
    return xml + '</w:tbl>'
  }

  hfRefs = ''
  hfFiles: Record<string, Uint8Array> = {}

  /** Write header/footer parts (each with its own relationships) and remember their sectPr references. */
  headersFooters(hf: HeadersFooters | null) {
    if (!hf) return
    let n = 0
    for (const kind of ['header', 'footer'] as const) {
      for (const variant of ['default', 'first', 'even'] as const) {
        const content = hf[kind][variant] as JSONContent[] | null | undefined
        if (!content?.length) continue
        if (variant === 'first' && !hf.differentFirst) continue
        if (variant === 'even' && !hf.differentOddEven) continue
        n++
        const docRels = this.rels
        this.rels = []
        let body = this.blocks(content)
        if (!body.trimEnd().endsWith('</w:p>') && !body.trimEnd().endsWith('</w:tbl>')) body += '<w:p/>'
        const partRels = this.rels
        this.rels = docRels
        const tag = kind === 'header' ? 'hdr' : 'ftr'
        const name = `${kind}${n}.xml`
        this.hfFiles[`word/${name}`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${NSDECL}>${body}</w:${tag}>`)
        if (partRels.length) this.hfFiles[`word/_rels/${name}.rels`] = strToU8(relationshipsXml(partRels))
        const id = this.rel(`http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`, name)
        this.hfRefs += `<w:${kind}Reference w:type="${variant}" r:id="${id}"/>`
      }
    }
    // headerReferences must precede footerReferences
    this.hfRefs = (this.hfRefs.match(/<w:headerReference[^>]*\/>/g) ?? []).join('') + (this.hfRefs.match(/<w:footerReference[^>]*\/>/g) ?? []).join('')
  }

  sectPr(hf: HeadersFooters | null): string {
    const p = this.page
    const m = p.margins
    const orient = p.orientation === 'landscape' ? ' w:orient="landscape"' : ''
    const FMT: Record<string, string> = { '1': 'decimal', i: 'lowerRoman', I: 'upperRoman', a: 'lowerLetter', A: 'upperLetter' }
    const nb = p.numbering
    const pgNum = nb && (nb.format !== '1' || nb.start !== 1) ? `<w:pgNumType w:fmt="${FMT[nb.format]}" w:start="${nb.start}"/>` : ''
    const titlePg = hf?.differentFirst ? '<w:titlePg/>' : ''
    return `<w:sectPr>${this.hfRefs}<w:pgSz w:w="${tw(p.width)}" w:h="${tw(p.height)}"${orient}/><w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(m.header)}" w:footer="${tw(m.footer)}" w:gutter="${tw(m.gutter)}"/>${pgNum}<w:cols w:space="720"/>${titlePg}<w:docGrid w:linePitch="360"/></w:sectPr>`
  }

  // ---------- parts ----------
  stylesXml(): string {
    const runXml = (r: RunProps) => {
      const p: string[] = []
      if (r.fontFamily) p.push(`<w:rFonts w:ascii="${x(r.fontFamily)}" w:hAnsi="${x(r.fontFamily)}" w:cs="${x(r.fontFamily)}" w:eastAsia="${x(r.fontFamily)}"/>`)
      if (r.bold != null) p.push(r.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/>')
      if (r.italic != null) p.push(r.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/>')
      if (r.caps) p.push('<w:caps/>')
      if (r.smallCaps) p.push('<w:smallCaps/>')
      if (r.strike) p.push('<w:strike/>')
      const c = cssColorHex(r.color)
      if (c) p.push(`<w:color w:val="${c}"/>`)
      if (r.letterSpacing) p.push(`<w:spacing w:val="${tw(r.letterSpacing)}"/>`)
      if (r.fontSize) p.push(`<w:sz w:val="${Math.round(r.fontSize * 2)}"/><w:szCs w:val="${Math.round(r.fontSize * 2)}"/>`)
      if (r.underline) p.push('<w:u w:val="single"/>')
      return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : ''
    }
    const paraXml = (pp: ParaProps & { contextual?: boolean }, outline?: number) => {
      const p: string[] = []
      if (pp.keepNext) p.push('<w:keepNext/>')
      if (pp.keepLines) p.push('<w:keepLines/>')
      if (pp.pageBreakBefore) p.push('<w:pageBreakBefore/>')
      const sp: string[] = []
      if (pp.spaceBefore != null) sp.push(`w:before="${tw(pp.spaceBefore)}"`)
      if (pp.spaceAfter != null) sp.push(`w:after="${tw(pp.spaceAfter)}"`)
      if (pp.lineHeight != null) sp.push(`w:line="${Math.round(pp.lineHeight * 240)}" w:lineRule="auto"`)
      if (sp.length) p.push(`<w:spacing ${sp.join(' ')}/>`)
      const ind: string[] = []
      if (pp.indentLeft != null) ind.push(`w:left="${tw(pp.indentLeft)}"`)
      if (pp.indentRight != null) ind.push(`w:right="${tw(pp.indentRight)}"`)
      if (pp.indentFirst != null) ind.push(pp.indentFirst < 0 ? `w:hanging="${tw(-pp.indentFirst)}"` : `w:firstLine="${tw(pp.indentFirst)}"`)
      if (ind.length) p.push(`<w:ind ${ind.join(' ')}/>`)
      if (pp.contextual) p.push('<w:contextualSpacing/>')
      if (pp.align) p.push(`<w:jc w:val="${pp.align === 'justify' ? 'both' : pp.align}"/>`)
      if (outline) p.push(`<w:outlineLvl w:val="${outline - 1}"/>`)
      return p.length ? `<w:pPr>${p.join('')}</w:pPr>` : ''
    }
    const normal = resolveStyle(this.styles, 'Normal')
    const wordName = (id: string, name: string) => {
      const h = /^Heading([1-9])$/.exec(id)
      if (h) return `heading ${h[1]}`
      const toc = /^TOC([1-9])$/.exec(id)
      if (toc) return `toc ${toc[1]}`
      return ({ Caption: 'caption', NoSpacing: 'No Spacing', ListParagraph: 'List Paragraph', TOCHeading: 'TOC Heading', FootnoteText: 'footnote text', EndnoteText: 'endnote text' } as Record<string, string>)[id] ?? name
    }
    let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">`
    out += `<w:docDefaults><w:rPrDefault>${runXml({ fontFamily: normal.run.fontFamily ?? 'Calibri', fontSize: normal.run.fontSize ?? 11 }) || '<w:rPr/>'}</w:rPrDefault><w:pPrDefault>${paraXml({ spaceAfter: normal.para.spaceAfter ?? 8, lineHeight: normal.para.lineHeight ?? 1.15 }) || '<w:pPr/>'}</w:pPrDefault></w:docDefaults>`
    const ids = Object.keys(this.styles)
    if (!ids.includes('ListParagraph')) this.styles.ListParagraph = { id: 'ListParagraph', name: 'List Paragraph', type: 'paragraph', basedOn: 'Normal', para: { contextual: true } as ParaProps }
    for (const kind of this.usedNotes) {
      const T = kind === 'footnote' ? 'Footnote' : 'Endnote'
      if (!this.styles[`${T}Text`] || this.styles[`${T}Text`].hidden) this.styles[`${T}Text`] = { id: `${T}Text`, name: `${kind} text`, type: 'paragraph', basedOn: 'Normal', run: { fontSize: 9 }, para: { spaceAfter: 0, lineHeight: 1 } }
    }
    for (const lvl of this.tocLevels) if (!ids.includes(`TOC${lvl}`)) this.styles[`TOC${lvl}`] = { id: `TOC${lvl}`, name: `toc ${lvl}`, type: 'paragraph', basedOn: 'Normal', next: 'Normal', para: { spaceAfter: 4, indentLeft: (lvl - 1) * 14 }, run: lvl === 1 ? { bold: true } : {} }
    if (this.usedCode && !ids.includes('Code')) this.styles.Code = { id: 'Code', name: 'Code', type: 'paragraph', basedOn: 'Normal', run: { fontFamily: 'Courier New', fontSize: 9.5 }, para: { spaceAfter: 0, lineHeight: 1 } }
    for (const s of Object.values(this.styles)) {
      if (s.type !== 'paragraph') continue
      const isNormal = s.id === 'Normal'
      out += `<w:style w:type="paragraph"${isNormal ? ' w:default="1"' : ''} w:styleId="${x(s.id)}"><w:name w:val="${x(wordName(s.id, s.name))}"/>`
      if (s.basedOn && !isNormal) out += `<w:basedOn w:val="${x(s.basedOn)}"/>`
      if (s.next) out += `<w:next w:val="${x(s.next)}"/>`
      if (s.builtin || isNormal) out += '<w:qFormat/>'
      out += paraXml(s.para ?? {}, s.outline ?? (/^Heading([1-9])$/.exec(s.id) ? Number(s.id.slice(7)) : undefined))
      out += runXml(s.run ?? {})
      out += '</w:style>'
    }
    out += `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>`
    if (this.commentSpans.size) {
      out += `<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>`
      out += `<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>`
    }
    for (const kind of this.usedNotes) {
      const T = kind === 'footnote' ? 'Footnote' : 'Endnote'
      out += `<w:style w:type="character" w:styleId="${T}Reference"><w:name w:val="${kind} reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`
    }
    out += `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="1F5BD8"/><w:u w:val="single"/></w:rPr></w:style>`
    out += `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`
    out += `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F7"/></w:tcPr></w:tblStylePr></w:style>`
    out += `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:semiHidden/></w:style>`
    return out + '</w:styles>'
  }

  numberingXml(): string {
    const FMT: Record<string, string> = { '1': 'decimal', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman', '1.1': 'decimal' }
    let abs = ''
    let nums = ''
    this.lists.forEach((l, k) => {
      const id = k + 1
      let lvls = ''
      for (let i = 0; i < 9; i++) {
        const lv = l.levels[i] ?? l.levels[l.levels.length - 1] ?? { kind: 'bullet', type: '1', bullet: '•' }
        const left = 36 * (i + 1)
        const ind = `<w:pPr><w:ind w:left="${tw(left)}" w:hanging="${tw(18)}"/></w:pPr>`
        if (lv.kind === 'bullet' || !l.levels[i]) {
          const b = l.levels[i]?.kind === 'bullet' ? l.levels[i].bullet : DEFAULT_BULLETS[i % 3]
          lvls += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${x(b)}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`
        } else {
          const text = lv.type === '1.1' ? Array.from({ length: i + 1 }, (_, j) => `%${j + 1}`).join('.') + '.' : `%${i + 1}.`
          lvls += `<w:lvl w:ilvl="${i}"><w:start w:val="${i === 0 ? l.start : 1}"/><w:numFmt w:val="${FMT[lv.type]}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`
        }
      }
      abs += `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls}</w:abstractNum>`
      nums += `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`
    })
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abs}${nums}</w:numbering>`
  }
}

/** Insert `el` before the first of `followers` (elements that must come after it), else before </w:settings>. */
function insertSetting(xml: string, el: string, followers: string[]): string {
  const m = new RegExp(`<w:(${followers.join('|')})\\b`).exec(xml)
  if (m) return xml.slice(0, m.index) + el + xml.slice(m.index)
  return xml.includes('</w:settings>') ? xml.replace('</w:settings>', `${el}</w:settings>`) : xml
}

/** Parts no relationship leads to any more (OPC: every part is reached from the package rels). */
function unreachable(files: Record<string, Uint8Array>): string[] {
  const seen = new Set(['[Content_Types].xml'])
  const visit = (part: string) => {
    if (seen.has(part) || !files[part]) return
    seen.add(part)
    const rels = part === '' ? '_rels/.rels' : part.replace(/([^/]+)$/, '_rels/$1.rels')
    if (!files[rels]) return
    seen.add(rels)
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : ''
    for (const [tag] of strFromU8(files[rels]).matchAll(/<Relationship\b[^>]*>/g)) {
      const target = /Target="([^"]*)"/.exec(tag)?.[1]
      if (!target || /TargetMode="External"/.test(tag)) continue
      const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/')
      const out: string[] = []
      for (const seg of parts) seg === '..' ? out.pop() : seg !== '.' && out.push(seg)
      visit(decodeURIComponent(out.join('/')))
    }
  }
  files[''] = new Uint8Array()
  visit('')
  delete files['']
  return Object.keys(files).filter((p) => !seen.has(p))
}

function relationshipsXml(rels: { id: string; type: string; target: string; external?: boolean }[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`
}

function cssColorHex(c: string | undefined | null): string | null {
  if (!c) return null
  const s = c.trim().toLowerCase()
  let m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase()
  m = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s)
  if (m) return [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

function parseSizePt(v: string | undefined | null): number | null {
  if (!v) return null
  const m = /^([\d.]+)(pt|px)?$/.exec(v.trim())
  if (!m) return null
  return m[2] === 'px' ? parseFloat(m[1]) * 0.75 : parseFloat(m[1])
}

export function exportDocx(doc: JSONContent, carry: DocxCarry | null = null): ExportResult {
  const page = (doc.attrs?.page as PageSetup | undefined) ?? makePageSetup()
  const styles: StyleMap = { ...defaultStyles(), ...((doc.attrs?.styles as StyleMap | undefined) ?? {}) }
  const meta = (doc.attrs?.meta ?? {}) as DocMeta
  const wr = new Writer(page, structuredClone(styles), carry)

  const hf = (doc.attrs?.hf as HeadersFooters | null | undefined) ?? null
  wr.prepareComments(doc)
  const body = wr.blocks(doc.content)
  wr.headersFooters(hf)
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NSDECL}><w:body>${body}${wr.sectPr(hf)}</w:body></w:document>`

  const files: Record<string, Uint8Array> = {}
  const overridesExtra: Record<string, string> = {}
  // Carry over parts we do not regenerate (headers, footers, footnotes, theme, fonts, settings, media used by preserved XML…).
  const carriedRels: string[] = []
  if (carry) {
    const converted = new Set(carry.converted ?? [])
    const skip = (path: string) => GENERATED.has(path) || converted.has(path) || [...converted].some((c) => path === c.replace(/([^/]+)$/, '_rels/$1.rels')) || path.startsWith('customXml/') || path === 'docProps/custom.xml'
    for (const [path, data] of Object.entries(carry.parts)) if (!skip(path)) files[path] = data
    for (const r of carry.rels) {
      if (/\/(styles|numbering|header|footer|footnotes|endnotes|comments|commentsExtended|commentsIds|commentsExtensible)$/.test(r.type)) continue
      if (r.type.endsWith('/hyperlink') || r.type.endsWith('/image') || !r.external) {
        const target = r.external ? r.target : r.target.startsWith('word/') ? r.target.slice(5) : `../${r.target}`
        if (!r.external && !files[r.target]) continue
        // Content the document no longer refers to (a replaced image or chart) is not carried.
        if (/\/(image|hyperlink|chart|package|oleObject)$/.test(r.type) && !documentXml.includes(`="${r.id}"`)) continue
        carriedRels.push(`<Relationship Id="${x(r.id)}" Type="${x(r.type)}" Target="${x(target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
      }
    }
  }
  if (!carry || !files['word/settings.xml']) {
    files['word/settings.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    )
    if (!carriedRels.some((r) => r.includes('/settings"'))) wr.rels.push({ id: 'sdRsettings', type: REL.settings, target: 'settings.xml' })
  }
  wr.rels.push({ id: 'sdRstyles', type: REL.styles, target: 'styles.xml' })
  if (wr.lists.length) wr.rels.push({ id: 'sdRnumbering', type: REL.numbering, target: 'numbering.xml' })

  files['word/document.xml'] = strToU8(documentXml)
  Object.assign(files, wr.hfFiles)
  const cx = wr.commentsXml()
  if (cx) {
    files['word/comments.xml'] = strToU8(cx.comments)
    files['word/commentsExtended.xml'] = strToU8(cx.extended)
    wr.rels.push({ id: 'sdRcomments', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments', target: 'comments.xml' })
    wr.rels.push({ id: 'sdRcommentsEx', type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', target: 'commentsExtended.xml' })
    overridesExtra['word/comments.xml'] = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
    overridesExtra['word/commentsExtended.xml'] = 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'
  }
  for (const kind of wr.usedNotes) {
    files[`word/${kind}s.xml`] = strToU8(wr.notesPart(kind))
    if (wr.noteRels[kind].length) files[`word/_rels/${kind}s.xml.rels`] = strToU8(relationshipsXml(wr.noteRels[kind]))
    wr.rels.push({ id: `sdR${kind}s`, type: `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}s`, target: `${kind}s.xml` })
    overridesExtra[`word/${kind}s.xml`] = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml`
  }
  for (const p of Object.keys(wr.hfFiles)) if (!p.endsWith('.rels')) overridesExtra[p] = p.includes('/header') ? CT.header : CT.footer
  // settings.xml flags we own (removed, then re-added where CT_Settings' element order allows).
  {
    let st = files['word/settings.xml'] ? strFromU8(files['word/settings.xml']) : ''
    st = st.replace(/<w:evenAndOddHeaders[^>]*\/>/g, '').replace(/<w:trackRevisions[^>]*\/>/g, '').replace(/<w:documentProtection\b[^>]*\/>/g, '')
    if (doc.attrs?.trackChanges) st = insertSetting(st, '<w:trackRevisions/>', ['doNotTrackMoves', 'doNotTrackFormatting', 'documentProtection', 'autoFormatOverride', 'styleLockTheme', 'styleLockQFSet', 'defaultTabStop'])
    const edit = { readOnly: 'readOnly', comments: 'comments', tracked: 'trackedChanges' }[doc.attrs?.protection as string]
    if (edit) st = insertSetting(st, `<w:documentProtection w:edit="${edit}" w:enforcement="1"/>`, ['autoFormatOverride', 'styleLockTheme', 'styleLockQFSet', 'defaultTabStop', 'autoHyphenation', 'consecutiveHyphenLimit', 'hyphenationZone', 'doNotHyphenateCaps', 'showEnvelope', 'summaryLength', 'clickAndTypeStyle', 'defaultTableStyle', 'evenAndOddHeaders', 'bookFoldRevPrinting', 'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing', 'drawingGridVerticalSpacing', 'characterSpacingControl', 'compat', 'rsids'])
    if (hf?.differentOddEven) st = insertSetting(st, '<w:evenAndOddHeaders/>', ['bookFoldRevPrinting', 'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing', 'drawingGridVerticalSpacing', 'displayHorizontalDrawingGridEvery', 'displayVerticalDrawingGridEvery', 'doNotUseMarginsForDrawingGridOrigin', 'doNotShadeFormData', 'noPunctuationKerning', 'characterSpacingControl', 'compat', 'rsids'])
    files['word/settings.xml'] = strToU8(st)
  }
  // Custom XML data (customXml parts from the original file are not carried): bibliography sources
  // for Word's citation tools, and the mail-merge recipient list (ours; Word keeps it untouched).
  const customXml: [string, string][] = []
  const sources = doc.attrs?.sources as SourceMap | null
  if (sources && Object.keys(sources).length) customXml.push([sourcesXml(sources, (doc.attrs?.citationStyle as CitationStyle | null) ?? 'apa'), '{6A3F5C1E-5D2B-4C8A-9E1F-3B7D2A4C9E10}'])
  const merge = doc.attrs?.mergeData as MergeData | null
  if (merge?.fields.length) customXml.push([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sd:recipients xmlns:sd="${MERGE_NS}" name="${x(merge.name)}">${x(toCsv(merge)).replace(/\r/g, '&#13;')}</sd:recipients>`, '{3C1B7E52-9A4D-4F0E-8B6A-2D5C9E1F7A30}'])
  customXml.forEach(([xml, guid], k) => {
    const n = k + 1
    files[`customXml/item${n}.xml`] = strToU8(xml)
    files[`customXml/itemProps${n}.xml`] = strToU8(itemPropsXml(guid))
    files[`customXml/_rels/item${n}.xml.rels`] = strToU8(relationshipsXml([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps', target: `itemProps${n}.xml` }]))
    overridesExtra[`customXml/itemProps${n}.xml`] = 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml'
    wr.rels.push({ id: `sdRcustomXml${n}`, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml', target: `../customXml/item${n}.xml` })
  })
  files['word/styles.xml'] = strToU8(wr.stylesXml())
  if (wr.lists.length) files['word/numbering.xml'] = strToU8(wr.numberingXml())
  Object.assign(files, wr.media)

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${carriedRels.join('')}${wr.rels
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`
  files['word/_rels/document.xml.rels'] = strToU8(relsXml)

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const dt = (tag: string, v?: string) => (v ? `<${tag}>${x(v)}</${tag}>` : '')
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${dt('dc:title', meta.title)}${dt('dc:subject', meta.subject)}${dt('dc:creator', meta.author)}${dt('cp:keywords', meta.keywords)}${dt('dc:description', meta.description)}<dcterms:created xsi:type="dcterms:W3CDTF">${x(meta.created?.replace(/\.\d+Z$/, 'Z') ?? now)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  )
  files['docProps/app.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Simple Docs</Application></Properties>`
  )
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.office}" Target="word/document.xml"/><Relationship Id="rId2" Type="${REL.core}" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL.app}" Target="docProps/app.xml"/></Relationships>`
  )

  for (const p of unreachable(files)) delete files[p]

  const overrides: Record<string, string> = { 'word/document.xml': CT.document, 'word/styles.xml': CT.styles, 'word/settings.xml': CT.settings, 'docProps/core.xml': CT.core, 'docProps/app.xml': CT.app }
  if (wr.lists.length) overrides['word/numbering.xml'] = CT.numbering
  Object.assign(overrides, overridesExtra, wr.partTypes)
  if (carry) for (const [p, t] of Object.entries(carry.overrides)) if (files[p] && !overrides[p] && t) overrides[p] = t
  const defaults: Record<string, string> = { rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', bin: 'application/vnd.openxmlformats-officedocument.oleObject', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${Object.entries(defaults)
      .map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`)
      .join('')}${Object.entries(overrides)
      .map(([p, t]) => `<Override PartName="/${x(p)}" ContentType="${x(t)}"/>`)
      .join('')}</Types>`
  )

  return { data: zipSync(files, { level: 6 }), warnings: wr.w.list() }
}
