import { zipSync, strToU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { defaultStyles, makePageSetup, resolveStyle, type DocMeta, type HeadersFooters, type PageSetup, type ParaProps, type RunProps, type StyleMap } from '@/editor/model'
import { effectiveListType, DEFAULT_BULLETS } from '@/editor/numbering'
import type { CommentMap } from '@/editor/comments'
import { Warnings, type ExportResult } from '../types'
import { escXml as x, extFromMime, imageSize, parseDataUrl } from '../docx/xml'
import { ODF_DECL, encodeName, pt } from './common'

// Editor JSON → ODT (OpenDocument Text 1.3), without LibreOffice.

type Mark = { type: string; attrs?: Record<string, unknown> }

/** Deduplicating registry of automatic styles for one XML part. */
class AutoStyles {
  private byKey = new Map<string, string>()
  xml: string[] = []
  constructor(private prefix: string) {}
  get(family: string, props: string, parent?: string, extraAttrs = ''): string {
    const key = `${family}|${parent ?? ''}|${extraAttrs}|${props}`
    let name = this.byKey.get(key)
    if (!name) {
      name = `${this.prefix}${family[0].toUpperCase()}${this.byKey.size + 1}`
      this.byKey.set(key, name)
      this.xml.push(`<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}${extraAttrs}>${props}</style:style>`)
    }
    return name
  }
  raw(xml: string) {
    this.xml.push(xml)
  }
}

const NAMED: Record<string, string> = { Normal: 'Standard', Quote: 'Quotations', TOCHeading: 'Contents_20_Heading', FootnoteText: 'Footnote' }
const styleName = (id: string) => NAMED[id] ?? (/^Heading(\d)$/.test(id) ? `Heading_20_${id.slice(7)}` : encodeName(id))

function runProps(r: RunProps & { highlight?: string; vert?: string; dstrike?: boolean; code?: boolean }): string {
  const p: string[] = []
  if (r.fontFamily) p.push(`style:font-name="${x(r.fontFamily)}" fo:font-family="${x(r.fontFamily)}"`)
  if (r.fontSize) p.push(`fo:font-size="${pt(r.fontSize)}"`)
  if (r.bold != null) p.push(`fo:font-weight="${r.bold ? 'bold' : 'normal'}"`)
  if (r.italic != null) p.push(`fo:font-style="${r.italic ? 'italic' : 'normal'}"`)
  if (r.underline) p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"')
  if (r.strike) p.push('style:text-line-through-style="solid" style:text-line-through-type="single"')
  if (r.dstrike) p.push('style:text-line-through-style="solid" style:text-line-through-type="double"')
  if (r.color) p.push(`fo:color="${x(r.color)}"`)
  if (r.highlight) p.push(`fo:background-color="${x(r.highlight)}"`)
  if (r.vert) p.push(`style:text-position="${r.vert === 'super' ? 'super' : 'sub'} 58%"`)
  if (r.caps) p.push('fo:text-transform="uppercase"')
  if (r.smallCaps) p.push('fo:font-variant="small-caps"')
  if (r.letterSpacing) p.push(`fo:letter-spacing="${pt(r.letterSpacing)}"`)
  return p.length ? `<style:text-properties ${p.join(' ')}/>` : ''
}

function paraProps(a: ParaProps & { shading?: string | null; dir?: string | null; breakBefore?: boolean }, tabs = ''): string {
  const p: string[] = []
  if (a.align) p.push(`fo:text-align="${a.align === 'left' ? 'start' : a.align === 'right' ? 'end' : a.align}"`)
  if (a.lineHeight) p.push(`fo:line-height="${Math.round(a.lineHeight * 100)}%"`)
  if (a.spaceBefore != null) p.push(`fo:margin-top="${pt(a.spaceBefore)}"`)
  if (a.spaceAfter != null) p.push(`fo:margin-bottom="${pt(a.spaceAfter)}"`)
  if (a.indentLeft != null) p.push(`fo:margin-left="${pt(a.indentLeft)}"`)
  if (a.indentRight != null) p.push(`fo:margin-right="${pt(a.indentRight)}"`)
  if (a.indentFirst != null) p.push(`fo:text-indent="${pt(a.indentFirst)}"`)
  if (a.keepNext) p.push('fo:keep-with-next="always"')
  if (a.keepLines) p.push('fo:keep-together="always"')
  if (a.breakBefore || a.pageBreakBefore) p.push('fo:break-before="page"')
  if (a.shading) p.push(`fo:background-color="${x(a.shading)}"`)
  if (a.dir === 'rtl') p.push('style:writing-mode="rl-tb"')
  return p.length || tabs ? `<style:paragraph-properties ${p.join(' ')}>${tabs}</style:paragraph-properties>` : ''
}

/** ODF text: whitespace runs, tabs and line breaks need explicit elements. */
function odfText(s: string): string {
  let out = ''
  let prevSpace = true // leading spaces in a paragraph must be explicit
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\t') {
      out += '<text:tab/>'
      prevSpace = false
    } else if (c === '\n') {
      out += '<text:line-break/>'
      prevSpace = true
    } else if (c === ' ') {
      let n = 1
      while (s[i + n] === ' ') n++
      out += prevSpace ? `<text:s${n > 1 ? ` text:c="${n}"` : ''}/>` : ' ' + (n > 1 ? `<text:s${n > 2 ? ` text:c="${n - 1}"` : ''}/>` : '')
      i += n - 1
      prevSpace = false
    } else {
      out += x(c)
      prevSpace = false
    }
  }
  return out
}

class OdtWriter {
  w = new Warnings()
  auto = new AutoStyles('')
  hfAuto = new AutoStyles('M')
  /** Which registry the current content goes to (headers/footers live in styles.xml). */
  cur = this.auto
  pictures: Record<string, Uint8Array> = {}
  pictureTypes: Record<string, string> = {}
  noteSeq = 0
  listSeq = 0
  tableSeq = 0
  frameSeq = 0
  pendingBreak = false
  usedTocLevels = new Set<number>()
  comments: CommentMap = {}
  commentSpans = new Map<string, { first: JSONContent; last: JSONContent }>()
  contentWidth: number

  constructor(public page: PageSetup) {
    this.contentWidth = page.width - page.margins.left - page.margins.right
  }

  prepareComments(doc: JSONContent) {
    this.comments = (doc.attrs?.comments as CommentMap | null) ?? {}
    const walk = (n: JSONContent) => {
      if (n.type === 'text')
        for (const m of n.marks ?? []) {
          const id = m.attrs?.id as string
          if (m.type !== 'comment' || !this.comments[id]) continue
          const span = this.commentSpans.get(id)
          if (span) span.last = n
          else this.commentSpans.set(id, { first: n, last: n })
        }
      n.content?.forEach(walk)
    }
    walk(doc)
  }

  annotation(id: string): string {
    const t = this.comments[id]
    const one = (c: { author: string; date: string; text: string }, attrs: string) =>
      `<office:annotation${attrs}><dc:creator>${x(c.author)}</dc:creator>${c.date ? `<dc:date>${x(c.date.replace(/Z$/, ''))}</dc:date>` : ''}${(c.text || ' ')
        .split('\n')
        .map((l) => `<text:p>${odfText(l)}</text:p>`)
        .join('')}</office:annotation>`
    return (
      one(t, ` office:name="__Annotation__${id}"${t.resolved ? ' loext:resolved="true"' : ''}`) +
      t.replies.map((r, i) => one(r, ` office:name="__Annotation__${id}_${i}" loext:parent-name="__Annotation__${id}"`) + `<office:annotation-end office:name="__Annotation__${id}_${i}"/>`).join('')
    )
  }

  // ---------- inline ----------
  inline(nodes: JSONContent[] = []): string {
    let out = ''
    let i = 0
    while (i < nodes.length) {
      const n = nodes[i]
      const link = n.marks?.find((m) => m.type === 'link')
      if (link) {
        const href = String(link.attrs?.href ?? '')
        let inner = ''
        while (i < nodes.length && nodes[i].marks?.some((m) => m.type === 'link' && m.attrs?.href === href)) inner += this.inlineNode(nodes[i++])
        out += `<text:a xlink:type="simple" xlink:href="${x(href)}">${inner}</text:a>`
        continue
      }
      out += this.inlineNode(n)
      i++
    }
    return out
  }

  spanStyle(marks: Mark[] = []): string | null {
    const has = (t: string) => marks.some((m) => m.type === t)
    const ts = marks.find((m) => m.type === 'textStyle')?.attrs ?? {}
    const r = {
      fontFamily: (ts.fontFamily as string | undefined)?.split(',')[0].replace(/["']/g, '').trim() ?? (has('code') ? 'Liberation Mono' : undefined),
      fontSize: ts.fontSize ? parseFloat(String(ts.fontSize)) * (String(ts.fontSize).endsWith('px') ? 0.75 : 1) : undefined,
      bold: has('bold') || undefined,
      italic: has('italic') || undefined,
      underline: has('underline'),
      strike: has('strike'),
      dstrike: has('doubleStrike'),
      color: ts.color as string | undefined,
      highlight: marks.find((m) => m.type === 'highlight')?.attrs?.color as string | undefined,
      vert: has('superscript') ? 'super' : has('subscript') ? 'sub' : undefined,
      caps: !!ts.caps,
      smallCaps: !!ts.smallCaps,
      letterSpacing: typeof ts.letterSpacing === 'number' ? ts.letterSpacing : undefined
    }
    const props = runProps(r)
    return props ? this.cur.get('text', props) : null
  }

  inlineNode(n: JSONContent): string {
    switch (n.type) {
      case 'text': {
        if (n.marks?.some((m) => m.type === 'deletion')) {
          this.w.add('loss', 'Tracked changes are saved as accepted text in ODT')
          return ''
        }
        if (n.marks?.some((m) => m.type === 'insertion')) this.w.add('loss', 'Tracked changes are saved as accepted text in ODT')
        let pre = ''
        let post = ''
        for (const [id, span] of this.commentSpans) {
          if (span.first === n) pre += this.annotation(id)
          if (span.last === n) post += `<office:annotation-end office:name="__Annotation__${id}"/>`
        }
        const style = this.spanStyle(n.marks as Mark[])
        const body = odfText(n.text ?? '')
        return pre + (style ? `<text:span text:style-name="${style}">${body}</text:span>` : body) + post
      }
      case 'hardBreak':
        return '<text:line-break/>'
      case 'image':
        return this.image(n)
      case 'equation':
        this.w.add('loss', 'Equations are saved as LaTeX text in ODT')
        return odfText(String(n.attrs?.latex ?? ''))
      case 'mergeField':
        this.w.add('loss', 'Mail-merge fields are saved as «name» text in ODT')
        return odfText(`«${n.attrs?.name ?? ''}»`)
      case 'citation':
        this.w.add('loss', 'Citations are saved as plain text (their link to the sources list is not kept)')
        return odfText(String(n.attrs?.text ?? ''))
      case 'field': {
        const k = String(n.attrs?.kind)
        if (k === 'page') return '<text:page-number text:select-page="current">1</text:page-number>'
        if (k === 'pages') return '<text:page-count>1</text:page-count>'
        if (k === 'date') return `<text:date>${x(new Date().toLocaleDateString())}</text:date>`
        if (k === 'title') return '<text:title/>'
        return '<text:initial-creator/>'
      }
      case 'footnote': {
        const kind = n.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
        const id = ++this.noteSeq
        return `<text:note text:id="${kind === 'endnote' ? 'edn' : 'ftn'}${id}" text:note-class="${kind}"><text:note-citation>${id}</text:note-citation><text:note-body>${this.blocks((n.attrs?.content as JSONContent[]) ?? [], 'FootnoteText')}</text:note-body></text:note>`
      }
      case 'preservedInline':
        if (n.attrs?.format === 'odt' && n.attrs.raw) return String(n.attrs.raw)
        this.w.add('loss', `${n.attrs?.label ?? 'Preserved content'} from another format is saved as plain text`)
        return odfText(String(n.attrs?.text ?? ''))
      default:
        return ''
    }
  }

  image(n: JSONContent): string {
    const a = n.attrs ?? {}
    if (a.drawing) this.w.add('loss', 'Charts and shapes are saved as pictures in ODT (DOCX keeps them editable)')
    const parsed = parseDataUrl(String(a.src ?? ''))
    if (!parsed) {
      this.w.add('loss', 'Linked (non-embedded) images were left out')
      return ''
    }
    const ext = extFromMime(parsed.mime)
    if (ext === 'bin') return ''
    const name = `Pictures/image${Object.keys(this.pictures).length + 1}.${ext === 'jpeg' ? 'jpg' : ext}`
    this.pictures[name] = parsed.bytes
    this.pictureTypes[name] = parsed.mime
    const nat = imageSize(parsed.bytes) ?? { width: 300, height: 200 }
    let wpx = Number(a.width) || nat.width
    let hpx = Number(a.height) || (nat.height * wpx) / nat.width
    const maxPx = (this.contentWidth * 96) / 72
    if (wpx > maxPx) {
      hpx = (hpx * maxPx) / wpx
      wpx = maxPx
    }
    const floated = a.float === 'left' || a.float === 'right'
    const style = this.cur.get('graphic', `<style:graphic-properties style:wrap="${floated ? (a.float === 'left' ? 'right' : 'left') : 'none'}" style:horizontal-pos="${floated ? a.float : 'center'}" style:horizontal-rel="paragraph" style:vertical-pos="top" style:vertical-rel="${floated ? 'paragraph' : 'baseline'}" fo:margin-left="${floated ? '6pt' : '0pt'}" fo:margin-right="${floated ? '6pt' : '0pt'}"/>`)
    const id = ++this.frameSeq
    return `<draw:frame draw:style-name="${style}" draw:name="Image${id}" text:anchor-type="${floated ? 'char' : 'as-char'}" svg:width="${pt(wpx * 0.75)}" svg:height="${pt(hpx * 0.75)}" draw:z-index="${id}"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${parsed.mime}"/>${a.title ? `<svg:title>${x(String(a.title))}</svg:title>` : ''}${a.alt ? `<svg:desc>${x(String(a.alt))}</svg:desc>` : ''}</draw:frame>`
  }

  // ---------- blocks ----------
  paragraph(n: JSONContent, named?: string, extra: Partial<ParaProps & { breakBefore: boolean }> = {}): string {
    const a = (n.attrs ?? {}) as Record<string, unknown>
    const isHeading = n.type === 'heading'
    const id = isHeading ? ((a.styleId as string) ?? `Heading${Math.min(9, Number(a.level) || 1)}`) : ((a.styleId as string) ?? named ?? 'Normal')
    const breakBefore = this.pendingBreak || extra.breakBefore
    this.pendingBreak = false
    const props = paraProps({ ...(a as ParaProps), shading: a.shading as string | null, dir: a.dir as string | null, ...extra, breakBefore })
    const style = props ? this.cur.get('paragraph', props, styleName(id)) : styleName(id)
    const body = this.inline(n.content)
    return isHeading ? `<text:h text:style-name="${style}" text:outline-level="${Math.min(10, Number(a.level) || 1)}">${body}</text:h>` : `<text:p text:style-name="${style}">${body}</text:p>`
  }

  blocks(nodes: JSONContent[] = [], named?: string): string {
    return nodes.map((n) => this.block(n, named)).join('')
  }

  block(n: JSONContent, named?: string): string {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        return this.paragraph(n, named)
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return this.list(n)
      case 'blockquote':
        return this.blocks(n.content, 'Quote')
      case 'codeBlock': {
        const text = (n.content ?? []).map((t) => t.text ?? '').join('')
        const style = this.cur.get('paragraph', `${paraProps({ spaceAfter: 0, lineHeight: 1 })}<style:text-properties style:font-name="Liberation Mono" fo:font-family="Liberation Mono" fo:font-size="9.5pt"/>`, 'Standard')
        return text.split('\n').map((l) => `<text:p text:style-name="${style}">${odfText(l)}</text:p>`).join('')
      }
      case 'horizontalRule': {
        const style = this.cur.get('paragraph', '<style:paragraph-properties fo:border-bottom="0.5pt solid #c8c8d0" fo:padding-bottom="2pt"/>', 'Standard')
        return `<text:p text:style-name="${style}"/>`
      }
      case 'pageBreak':
        this.pendingBreak = true
        return ''
      case 'sectionBreak':
        this.w.add('loss', 'Section breaks are saved as page breaks in ODT')
        if (n.attrs?.kind !== 'continuous') this.pendingBreak = true
        return ''
      case 'table':
        return this.table(n)
      case 'toc':
        return this.toc(n)
      case 'preservedBlock':
        if (n.attrs?.format === 'odt' && n.attrs.raw) return String(n.attrs.raw)
        this.w.add('loss', `${n.attrs?.label ?? 'Preserved content'} from another format is saved as plain text`)
        return `<text:p>${odfText(String(n.attrs?.text ?? ''))}</text:p>`
      default:
        return n.content ? this.blocks(n.content, named) : ''
    }
  }

  list(n: JSONContent): string {
    const name = `L${++this.listSeq}`
    const levels: string[] = []
    const levelKinds: { ordered: boolean; type: string; bullet: string; start: number }[] = []
    const scan = (list: JSONContent, depth: number) => {
      if (!levelKinds[depth])
        levelKinds[depth] = {
          ordered: list.type === 'orderedList',
          type: effectiveListType(list.attrs?.type, depth),
          bullet: list.type === 'taskList' ? ' ' : ((list.attrs?.bullet as string) ?? DEFAULT_BULLETS[depth % 3]),
          start: depth === 0 ? Number(list.attrs?.start) || 1 : 1
        }
      for (const item of list.content ?? []) for (const c of item.content ?? []) if (/List$/.test(c.type ?? '')) scan(c, depth + 1)
    }
    scan(n, 0)
    for (let i = 0; i < 10; i++) {
      const k = levelKinds[i] ?? levelKinds[levelKinds.length - 1]
      const props = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(36 * (i + 1))}" fo:text-indent="-18pt" fo:margin-left="${pt(36 * (i + 1))}"/></style:list-level-properties>`
      if (k.ordered) {
        const outline = k.type === '1.1'
        levels.push(`<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${outline ? '1' : k.type}"${outline ? ` text:display-levels="${i + 1}"` : ''}${k.start !== 1 && i === 0 ? ` text:start-value="${k.start}"` : ''}>${props}</text:list-level-style-number>`)
      } else levels.push(`<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${x(k.bullet)}">${props}</text:list-level-style-bullet>`)
    }
    this.cur.raw(`<text:list-style style:name="${name}">${levels.join('')}</text:list-style>`)
    const render = (list: JSONContent, top: boolean): string => {
      const items = (list.content ?? [])
        .map((item) => {
          const inner = (item.content ?? [])
            .map((c, i) => {
              if (/List$/.test(c.type ?? '')) return render(c, false)
              if (i === 0 && list.type === 'taskList' && c.type === 'paragraph') {
                const box = item.attrs?.checked ? '☒ ' : '☐ '
                return this.paragraph({ ...c, content: [{ type: 'text', text: box }, ...(c.content ?? [])] })
              }
              return this.block(c)
            })
            .join('')
          return `<text:list-item>${inner || '<text:p/>'}</text:list-item>`
        })
        .join('')
      return `<text:list${top ? ` text:style-name="${name}"` : ''}>${items}</text:list>`
    }
    return render(n, true)
  }

  table(n: JSONContent): string {
    const rows = n.content ?? []
    const id = ++this.tableSeq
    // Grid with row/column spans (covered cells must be emitted explicitly).
    const occupied: boolean[][] = []
    let width = 0
    const grid = rows.map((row, r) => {
      const cells: { cell: JSONContent | null; col: number }[] = []
      let col = 0
      for (const cell of row.content ?? []) {
        while (occupied[r]?.[col]) {
          cells.push({ cell: null, col })
          col++
        }
        const cs = Number(cell.attrs?.colspan) || 1
        const rs = Number(cell.attrs?.rowspan) || 1
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) ((occupied[r + dr] ??= [])[col + dc] = true)
        cells.push({ cell, col })
        for (let dc = 1; dc < cs; dc++) cells.push({ cell: null, col: col + dc })
        col += cs
      }
      while (occupied[r]?.[col]) {
        cells.push({ cell: null, col })
        col++
      }
      width = Math.max(width, col)
      return { cells, header: (row.content ?? []).every((c) => c.type === 'tableHeader') }
    })
    const colPx: number[] = Array.from({ length: width }, () => 0)
    for (const row of rows) {
      let col = 0
      for (const c of row.content ?? []) {
        const cw = c.attrs?.colwidth as number[] | null
        const cs = Number(c.attrs?.colspan) || 1
        if (cw && cw.length === cs) cw.forEach((v, k) => (colPx[col + k] ||= v))
        col += cs
      }
    }
    const known = colPx.reduce((s, v) => s + v * 0.75, 0)
    const unknown = colPx.filter((v) => !v).length
    const rest = Math.max(30, (this.contentWidth - known) / Math.max(1, unknown))
    const colPt = colPx.map((v) => (v ? v * 0.75 : rest))
    const total = colPt.reduce((s, v) => s + v, 0)
    const breakBefore = this.pendingBreak
    this.pendingBreak = false
    const tStyle = this.cur.get('table', `<style:table-properties style:width="${pt(total)}" table:align="left"${breakBefore ? ' fo:break-before="page"' : ''}/>`)
    const cols = colPt.map((w) => `<table:table-column table:style-name="${this.cur.get('table-column', `<style:table-column-properties style:column-width="${pt(w)}"/>`)}"/>`).join('')
    const cellXml = (cell: JSONContent | null) => {
      if (!cell) return '<table:covered-table-cell/>'
      const a = cell.attrs ?? {}
      const tStyleName = n.attrs?.tableStyle as string | null | undefined
      const borders =
        tStyleName === 'plain'
          ? 'fo:border="none"'
          : tStyleName === 'lines'
            ? 'fo:border-top="0.5pt solid #b9b9c3" fo:border-bottom="0.5pt solid #b9b9c3" fo:border-left="none" fo:border-right="none"'
            : `fo:border="0.5pt solid ${tStyleName === 'striped' ? '#e3e3ea' : '#b9b9c3'}"`
      const props = `<style:table-cell-properties fo:padding="3pt" ${borders}${a.background ? ` fo:background-color="${x(String(a.background))}"` : cell.type === 'tableHeader' && tStyleName !== 'plain' && tStyleName !== 'lines' ? ' fo:background-color="#f4f4f7"' : ''}${a.verticalAlign ? ` style:vertical-align="${a.verticalAlign === 'middle' ? 'middle' : 'bottom'}"` : ''}/>`
      const cs = Number(a.colspan) || 1
      const rs = Number(a.rowspan) || 1
      const body = this.blocks(cell.content) || '<text:p/>'
      return `<table:table-cell table:style-name="${this.cur.get('table-cell', props)}" office:value-type="string"${cs > 1 ? ` table:number-columns-spanned="${cs}"` : ''}${rs > 1 ? ` table:number-rows-spanned="${rs}"` : ''}>${body}</table:table-cell>`
    }
    const rowXml = (g: (typeof grid)[number]) => `<table:table-row>${g.cells.map((c) => cellXml(c.cell)).join('')}</table:table-row>`
    const headerCount = grid.findIndex((g) => !g.header)
    const head = headerCount > 0 ? `<table:table-header-rows>${grid.slice(0, headerCount).map(rowXml).join('')}</table:table-header-rows>` : ''
    const bodyRows = grid.slice(Math.max(0, headerCount === -1 ? grid.length : headerCount)).map(rowXml).join('')
    return `<table:table table:name="Table${id}" table:style-name="${tStyle}">${cols}${head}${bodyRows}</table:table>`
  }

  toc(n: JSONContent): string {
    const max = Number(n.attrs?.maxLevel) || 3
    const entries = (n.content ?? [])
      .map((e) => {
        const level = Math.min(10, Number(e.attrs?.level) || 1)
        this.usedTocLevels.add(level)
        return `<text:p text:style-name="Contents_20_${level}">${this.inline(e.content)}<text:tab/>${x(String(e.attrs?.page ?? ''))}</text:p>`
      })
      .join('')
    const templates = Array.from({ length: max }, (_, i) => `<text:table-of-content-entry-template text:outline-level="${i + 1}" text:style-name="Contents_20_${i + 1}"><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:table-of-content-entry-template>`).join('')
    return `<text:table-of-content text:protected="true" text:name="Table of Contents1"><text:table-of-content-source text:outline-level="${max}" text:use-index-marks="false">${templates}</text:table-of-content-source><text:index-body>${entries}</text:index-body></text:table-of-content>`
  }
}

function namedStylesXml(styles: StyleMap, tocLevels: Set<number>, contentWidth: number): string {
  let out = ''
  const normal = resolveStyle(styles, 'Normal')
  out += `<style:default-style style:family="paragraph">${paraProps({ lineHeight: normal.para.lineHeight ?? 1.15, spaceAfter: normal.para.spaceAfter ?? 8 })}${runProps({ fontFamily: normal.run.fontFamily ?? 'Calibri', fontSize: normal.run.fontSize ?? 11 })}</style:default-style>`
  for (const s of Object.values(styles)) {
    if (s.type !== 'paragraph') continue
    const name = styleName(s.id)
    const h = /^Heading(\d)$/.exec(s.id)
    const outline = s.outline ?? (h ? Number(h[1]) : undefined)
    const display = h ? `Heading ${h[1]}` : s.id === 'Normal' ? 'Default Paragraph Style' : s.name
    const parent = s.id === 'Normal' ? '' : ` style:parent-style-name="${styleName(s.basedOn ?? 'Normal')}"`
    const next = s.next ? ` style:next-style-name="${styleName(s.next)}"` : ''
    out += `<style:style style:name="${name}" style:display-name="${x(display)}" style:family="paragraph"${parent}${next}${outline ? ` style:default-outline-level="${outline}"` : ''}>${paraProps(s.para ?? {})}${runProps(s.run ?? {})}</style:style>`
  }
  for (const lvl of tocLevels)
    out += `<style:style style:name="Contents_20_${lvl}" style:display-name="Contents ${lvl}" style:family="paragraph" style:parent-style-name="Standard" style:class="index">${paraProps({ indentLeft: (lvl - 1) * 14, spaceAfter: 4 }, `<style:tab-stops><style:tab-stop style:position="${pt(contentWidth - (lvl - 1) * 14)}" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops>`)}${lvl === 1 ? '<style:text-properties fo:font-weight="bold"/>' : ''}</style:style>`
  return out
}

/** `thumbnail`: a PNG of page 1, the preview file managers show for the file. */
export function exportOdt(doc: JSONContent, thumbnail?: Uint8Array): ExportResult {
  const page = (doc.attrs?.page as PageSetup | undefined) ?? makePageSetup()
  const styles: StyleMap = { ...defaultStyles(), ...((doc.attrs?.styles as StyleMap | undefined) ?? {}) }
  const meta = (doc.attrs?.meta ?? {}) as DocMeta
  const hf = (doc.attrs?.hf as HeadersFooters | null | undefined) ?? null
  const wr = new OdtWriter(page)
  wr.prepareComments(doc)
  let body = wr.blocks(doc.content)
  if (wr.pendingBreak) body += `<text:p text:style-name="${wr.auto.get('paragraph', paraProps({ breakBefore: true }), 'Standard')}"/>`

  // Headers/footers live in styles.xml with their own automatic styles.
  wr.cur = wr.hfAuto
  const hfXml = (kind: 'header' | 'footer') => {
    if (!hf) return ''
    const part = (tag: string, content: unknown[] | null | undefined) => (content?.length ? `<style:${tag}>${wr.blocks(content as JSONContent[])}</style:${tag}>` : '')
    return part(kind, hf[kind].default) + (hf.differentOddEven ? part(`${kind}-left`, hf[kind].even) : '') + (hf.differentFirst ? part(`${kind}-first`, hf[kind].first) : '')
  }
  const headerXml = hfXml('header')
  const footerXml = hfXml('footer')
  wr.cur = wr.auto

  const m = page.margins
  const hasHeader = headerXml.includes('<style:header>')
  const hasFooter = footerXml.includes('<style:footer>')
  // Our margins measure the body from the page edge; ODF's exclude the header/footer area.
  const hdrSpace = Math.max(14, m.top - m.header - 14)
  const ftrSpace = Math.max(14, m.bottom - m.footer - 14)
  const numFmt = page.numbering?.format ?? '1'
  const layout = `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${pt(page.width)}" fo:page-height="${pt(page.height)}" style:num-format="${numFmt}" style:print-orientation="${page.orientation}" fo:margin-top="${pt(hasHeader ? m.header : m.top)}" fo:margin-bottom="${pt(hasFooter ? m.footer : m.bottom)}" fo:margin-left="${pt(m.left)}" fo:margin-right="${pt(m.right)}"${page.background ? ` fo:background-color="${x(page.background)}"` : ''} style:writing-mode="lr-tb"/><style:header-style>${hasHeader ? `<style:header-footer-properties fo:min-height="${pt(hdrSpace)}" fo:margin-bottom="14pt"/>` : ''}</style:header-style><style:footer-style>${hasFooter ? `<style:header-footer-properties fo:min-height="${pt(ftrSpace)}" fo:margin-top="14pt"/>` : ''}</style:footer-style></style:page-layout>`
  if (page.numbering && page.numbering.start !== 1) wr.w.add('info', 'A custom starting page number is not kept in ODT')

  const fontNames = new Set<string>()
  const collectFonts = (xml: string) => {
    for (const mm of xml.matchAll(/style:font-name="([^"]+)"/g)) fontNames.add(mm[1])
  }
  const named = namedStylesXml(styles, wr.usedTocLevels, page.width - m.left - m.right)
  const autoContent = wr.auto.xml.join('')
  const autoStyles = wr.hfAuto.xml.join('')
  collectFonts(named + autoContent + autoStyles)
  const fontDecls = `<office:font-face-decls>${[...fontNames].map((f) => `<style:font-face style:name="${x(f)}" svg:font-family="'${x(f)}'"/>`).join('')}</office:font-face-decls>`

  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${ODF_DECL} office:version="1.3">${fontDecls}<office:automatic-styles>${autoContent}</office:automatic-styles><office:body><office:text>${body || '<text:p/>'}</office:text></office:body></office:document-content>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${ODF_DECL} office:version="1.3">${fontDecls}<office:styles>${named}</office:styles><office:automatic-styles>${layout}${autoStyles}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${headerXml}${footerXml}</style:master-page></office:master-styles></office:document-styles>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, '')
  const tag = (t: string, v?: string) => (v ? `<${t}>${x(v)}</${t}>` : '')
  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${ODF_DECL} office:version="1.3"><office:meta><meta:generator>Simple Docs</meta:generator>${tag('dc:title', meta.title)}${tag('dc:subject', meta.subject)}${tag('meta:initial-creator', meta.author)}${tag('dc:creator', meta.author)}${tag('meta:keyword', meta.keywords)}${tag('dc:description', meta.description)}<meta:creation-date>${x((meta.created ?? now).replace(/\.\d+Z$|Z$/, ''))}</meta:creation-date><dc:date>${now}</dc:date></office:meta></office:document-meta>`
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${Object.keys(wr.pictures)
    .map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${wr.pictureTypes[p]}"/>`)
    .join('')}${thumbnail ? '<manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/>' : ''}</manifest:manifest>`

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8(content),
    'styles.xml': strToU8(stylesXml),
    'meta.xml': strToU8(metaXml),
    'META-INF/manifest.xml': strToU8(manifest),
    ...wr.pictures
  }
  if (thumbnail) files['Thumbnails/thumbnail.png'] = thumbnail
  return { data: zipSync(files as never, { level: 6 }), warnings: wr.w.list() }
}
