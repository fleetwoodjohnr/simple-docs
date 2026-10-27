import { zipSync, strToU8, strFromU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { makePageSetup, resolveStyle, defaultStyles, type DocMeta, type HeadersFooters, type PageSetup, type ParaProps, type RunProps, type StyleMap } from '@/editor/model'
import { effectiveListType, DEFAULT_BULLETS, type ListType } from '@/editor/numbering'
import { Warnings, type ExportResult } from '../types'
import { HIGHLIGHT_NAMES, type DocxCarry } from './read'
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
  media: Record<string, Uint8Array> = {}
  relSeq = 0
  drawingId = 1
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
  }

  rel(type: string, target: string, external = false): string {
    const id = `sdR${++this.relSeq}`
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
        return (n.text ?? '')
          .split(/(\t)/)
          .filter(Boolean)
          .map((part) => (part === '\t' ? `<w:r>${rpr}<w:tab/></w:r>` : `<w:r>${rpr}<w:t xml:space="preserve">${x(part)}</w:t></w:r>`))
          .join('')
      }
      case 'hardBreak':
        return '<w:r><w:br/></w:r>'
      case 'image':
        return this.image(n)
      case 'preservedInline':
        return this.preserved(n, false)
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
    const name = `word/media/sd-image${Object.keys(this.media).length + 1}.${ext === 'jpeg' ? 'jpg' : ext}`
    this.media[name] = parsed.bytes
    const rid = this.rel(REL.image, name.replace('word/', ''))
    const natural = imageSize(parsed.bytes) ?? { width: 300, height: 200 }
    let w = Number(a.width) || natural.width
    let h = Number(a.height) || (natural.height * w) / natural.width
    if (w > this.contentWidthPx) {
      h = (h * this.contentWidthPx) / w
      w = this.contentWidthPx
    }
    const cx = Math.round(w * PX_TO_EMU)
    const cy = Math.round(h * PX_TO_EMU)
    const id = this.drawingId++
    const descr = a.alt ? ` descr="${x(String(a.alt))}"` : ''
    const title = a.title ? ` title="${x(String(a.title))}"` : ''
    const graphic = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"${descr}/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
    const docPr = `<wp:docPr id="${id}" name="Picture ${id}"${descr}${title}/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    if (a.float === 'left' || a.float === 'right') {
      return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${a.float}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${docPr}${graphic}</wp:anchor></w:drawing></w:r>`
    }
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}${graphic}</wp:inline></w:drawing></w:r>`
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
      case 'table':
        return this.table(n)
      case 'preservedBlock':
        return this.preserved(n, true)
      default:
        return n.content ? this.blocks(n.content, ctx) : ''
    }
  }
  usedCode = false

  /** Raw XML is written back only when every part it references travels with the document. */
  preserved(n: JSONContent, block: boolean): string {
    const raw = String(n.attrs?.raw ?? '')
    const rels = new Set(this.carry?.rels.map((r) => r.id) ?? [])
    const ok =
      n.attrs?.format === 'docx' &&
      raw &&
      this.carry &&
      [...raw.matchAll(/\br:(?:id|embed|link|dm|lo|qs|cs)="([^"]+)"/g)].every((m) => rels.has(m[1])) &&
      (!raw.includes('footnoteReference') || !!this.carry.parts['word/footnotes.xml']) &&
      (!raw.includes('endnoteReference') || !!this.carry.parts['word/endnotes.xml'])
    if (ok) return raw
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
    const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="B9B9C3"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B9B9C3"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B9B9C3"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B9B9C3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B9B9C3"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B9B9C3"/>'
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
        const bg = cssColorHex(a.background as string | undefined)
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
        if (partRels.length) this.hfFiles[`word/_rels/${name}.rels`] = strToU8(relsXml(partRels))
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
      return ({ Caption: 'caption', NoSpacing: 'No Spacing', ListParagraph: 'List Paragraph' } as Record<string, string>)[id] ?? name
    }
    let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">`
    out += `<w:docDefaults><w:rPrDefault>${runXml({ fontFamily: normal.run.fontFamily ?? 'Calibri', fontSize: normal.run.fontSize ?? 11 }) || '<w:rPr/>'}</w:rPrDefault><w:pPrDefault>${paraXml({ spaceAfter: normal.para.spaceAfter ?? 8, lineHeight: normal.para.lineHeight ?? 1.15 }) || '<w:pPr/>'}</w:pPrDefault></w:docDefaults>`
    const ids = Object.keys(this.styles)
    if (!ids.includes('ListParagraph')) this.styles.ListParagraph = { id: 'ListParagraph', name: 'List Paragraph', type: 'paragraph', basedOn: 'Normal', para: { contextual: true } as ParaProps }
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

function relsXml(rels: { id: string; type: string; target: string; external?: boolean }[]): string {
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
      if (/\/(styles|numbering|header|footer)$/.test(r.type)) continue
      if (r.type.endsWith('/hyperlink') || r.type.endsWith('/image') || !r.external) {
        const target = r.external ? r.target : r.target.startsWith('word/') ? r.target.slice(5) : `../${r.target}`
        if (!r.external && !files[r.target]) continue
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
  for (const p of Object.keys(wr.hfFiles)) if (!p.endsWith('.rels')) overridesExtra[p] = p.includes('/header') ? CT.header : CT.footer
  if (hf?.differentOddEven) {
    const st = files['word/settings.xml'] ? strFromU8(files['word/settings.xml']) : ''
    const cleaned = st.replace(/<w:evenAndOddHeaders[^>]*\/>/g, '')
    files['word/settings.xml'] = strToU8(
      /<w:defaultTabStop[^>]*\/>/.test(cleaned) ? cleaned.replace(/(<w:defaultTabStop[^>]*\/>)/, '$1<w:evenAndOddHeaders/>') : cleaned.replace(/(<w:settings[^>]*>)/, '$1<w:evenAndOddHeaders/>')
    )
  }
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

  const overrides: Record<string, string> = { 'word/document.xml': CT.document, 'word/styles.xml': CT.styles, 'word/settings.xml': CT.settings, 'docProps/core.xml': CT.core, 'docProps/app.xml': CT.app }
  if (wr.lists.length) overrides['word/numbering.xml'] = CT.numbering
  Object.assign(overrides, overridesExtra)
  if (carry) for (const [p, t] of Object.entries(carry.overrides)) if (files[p] && !overrides[p] && t) overrides[p] = t
  const defaults: Record<string, string> = { rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', bin: 'application/vnd.openxmlformats-officedocument.oleObject' }
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${Object.entries(defaults)
      .map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`)
      .join('')}${Object.entries(overrides)
      .map(([p, t]) => `<Override PartName="/${x(p)}" ContentType="${x(t)}"/>`)
      .join('')}</Types>`
  )

  return { data: zipSync(files, { level: 6 }), warnings: wr.w.list() }
}
