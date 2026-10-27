import { unzipSync, strFromU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { makePageSetup, PAGE_SIZES, type DocMeta, type HeadersFooters, type PageNumberFormat, type PageSetup, type ParaProps, type RunProps, type StyleDef, type StyleMap } from '@/editor/model'
import type { CommentMap } from '@/editor/comments'
import { Warnings, type ImportResult } from '../types'
import { attr, elements, mimeFromExt, parseXml, serialize, textOf, toBase64, type El } from '../docx/xml'
import { ODF, decodeName, lenPt } from './common'

// ODT (OpenDocument Text) → editor JSON, without LibreOffice.

type Mark = { type: string; attrs?: Record<string, unknown> }

interface OdfStyle {
  name: string
  family: string
  parent?: string
  display?: string
  outline?: number
  para: ParaProps & { breakBefore?: boolean; rtl?: boolean; shading?: string }
  run: RunProps & { highlight?: string; vert?: 'sub' | 'super'; dstrike?: boolean }
  cellBg?: string
  valign?: string
  colWidth?: number
  wrap?: string
  hpos?: string
  listStyle?: string
  numFormat?: PageNumberFormat
}

interface ListLevel {
  bullet: boolean
  char: string
  format: string
  start: number
  levels: number
}

const is = (e: El, ns: string, name: string) => e.namespaceURI === ns && e.localName === name
const a = (e: El | null | undefined, ns: string, name: string) => attr(e ?? null, ns, name)
const kids = (e: El | null | undefined) => elements(e ?? null)
const child = (e: El | null | undefined, ns: string, name: string) => kids(e).find((c) => is(c, ns, name)) ?? null

const BUILTIN: Record<string, string> = {
  standard: 'Normal',
  'default paragraph style': 'Normal',
  title: 'Title',
  subtitle: 'Subtitle',
  quotations: 'Quote',
  quote: 'Quote',
  caption: 'Caption',
  'contents heading': 'TOCHeading',
  'footnote': 'FootnoteText'
}

function color(v: string | null): string | undefined {
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined
}

class OdtReader {
  w = new Warnings()
  styles = new Map<string, OdfStyle>()
  lists = new Map<string, ListLevel[]>()
  fonts = new Map<string, string>()
  docStyles: StyleMap = {}
  comments: CommentMap = {}
  activeComments = new Set<string>()
  commentByName = new Map<string, string>()
  counters = new Map<string, number>()
  inHF = false
  imageCount = 0

  constructor(public files: Record<string, Uint8Array>) {}

  // ---------- styles ----------
  readStyles(container: El | null, auto: boolean) {
    for (const s of kids(container)) {
      if (is(s, ODF.style, 'style')) {
        const st = this.parseStyle(s)
        this.styles.set(st.name, st)
        if (!auto && st.family === 'paragraph') this.registerNamed(st)
      } else if (is(s, ODF.text, 'list-style')) {
        const levels: ListLevel[] = []
        for (const l of kids(s)) {
          const i = Number(a(l, ODF.text, 'level') ?? 1) - 1
          levels[i] = {
            bullet: is(l, ODF.text, 'list-level-style-bullet'),
            char: a(l, ODF.text, 'bullet-char') ?? '•',
            format: a(l, ODF.style, 'num-format') ?? '1',
            start: Number(a(l, ODF.text, 'start-value') ?? 1),
            levels: Number(a(l, ODF.text, 'display-levels') ?? 1)
          }
        }
        this.lists.set(a(s, ODF.style, 'name') ?? '', levels)
      } else if (is(s, ODF.style, 'default-style') && a(s, ODF.style, 'family') === 'paragraph') {
        const st = this.parseStyle(s)
        this.styles.set('__default', st)
      }
    }
  }

  parseStyle(s: El): OdfStyle {
    const pp = child(s, ODF.style, 'paragraph-properties')
    const tp = child(s, ODF.style, 'text-properties')
    const cp = child(s, ODF.style, 'table-cell-properties')
    const colp = child(s, ODF.style, 'table-column-properties')
    const gp = child(s, ODF.style, 'graphic-properties')
    const para: OdfStyle['para'] = {}
    if (pp) {
      const align = a(pp, ODF.fo, 'text-align')
      if (align) para.align = align === 'center' ? 'center' : align === 'end' || align === 'right' ? 'right' : align === 'justify' ? 'justify' : 'left'
      const lh = a(pp, ODF.fo, 'line-height')
      if (lh?.endsWith('%')) para.lineHeight = Math.round(parseFloat(lh)) / 100
      else if (lh && lenPt(lh)) para.lineHeight = Math.round((lenPt(lh)! / 13.2) * 100) / 100
      const mt = lenPt(a(pp, ODF.fo, 'margin-top'))
      const mb = lenPt(a(pp, ODF.fo, 'margin-bottom'))
      const ml = lenPt(a(pp, ODF.fo, 'margin-left'))
      const mr = lenPt(a(pp, ODF.fo, 'margin-right'))
      const ti = lenPt(a(pp, ODF.fo, 'text-indent'))
      if (mt != null) para.spaceBefore = mt
      if (mb != null) para.spaceAfter = mb
      if (ml != null) para.indentLeft = ml
      if (mr != null) para.indentRight = mr
      if (ti != null) para.indentFirst = ti
      if (a(pp, ODF.fo, 'keep-with-next') === 'always') para.keepNext = true
      if (a(pp, ODF.fo, 'keep-together') === 'always') para.keepLines = true
      if (a(pp, ODF.fo, 'break-before') === 'page') para.breakBefore = true
      if (a(pp, ODF.style, 'writing-mode')?.startsWith('rl')) para.rtl = true
      const bg = color(a(pp, ODF.fo, 'background-color'))
      if (bg) para.shading = bg
    }
    const run: OdfStyle['run'] = {}
    if (tp) {
      const font = a(tp, ODF.style, 'font-name') ?? a(tp, ODF.fo, 'font-family')
      if (font) run.fontFamily = this.fonts.get(font) ?? font.replace(/^['"]|['"]$/g, '')
      const size = lenPt(a(tp, ODF.fo, 'font-size'))
      if (size) run.fontSize = size
      const weight = a(tp, ODF.fo, 'font-weight')
      if (weight) run.bold = weight === 'bold' || Number(weight) >= 600
      const fs = a(tp, ODF.fo, 'font-style')
      if (fs) run.italic = fs === 'italic' || fs === 'oblique'
      const ul = a(tp, ODF.style, 'text-underline-style')
      if (ul) run.underline = ul !== 'none'
      const lt = a(tp, ODF.style, 'text-line-through-style')
      if (lt && lt !== 'none') {
        if (a(tp, ODF.style, 'text-line-through-type') === 'double') run.dstrike = true
        else run.strike = true
      }
      const c = color(a(tp, ODF.fo, 'color'))
      if (c) run.color = c
      const hl = color(a(tp, ODF.fo, 'background-color'))
      if (hl) run.highlight = hl
      const pos = a(tp, ODF.style, 'text-position') ?? ''
      if (/^(super|[1-9])/.test(pos)) run.vert = 'super'
      else if (/^(sub|-)/.test(pos)) run.vert = 'sub'
      if (a(tp, ODF.fo, 'text-transform') === 'uppercase') run.caps = true
      if (a(tp, ODF.fo, 'font-variant') === 'small-caps') run.smallCaps = true
      const ls = lenPt(a(tp, ODF.fo, 'letter-spacing'))
      if (ls) run.letterSpacing = ls
    }
    const outline = a(s, ODF.style, 'default-outline-level')
    return {
      name: a(s, ODF.style, 'name') ?? '',
      family: a(s, ODF.style, 'family') ?? '',
      parent: a(s, ODF.style, 'parent-style-name') ?? undefined,
      display: a(s, ODF.style, 'display-name') ?? undefined,
      outline: outline ? Number(outline) : undefined,
      para,
      run,
      cellBg: color(a(cp, ODF.fo, 'background-color')),
      valign: a(cp, ODF.style, 'vertical-align') ?? undefined,
      colWidth: lenPt(a(colp, ODF.style, 'column-width')) ?? undefined,
      wrap: a(gp, ODF.style, 'wrap') ?? undefined,
      hpos: a(gp, ODF.style, 'horizontal-pos') ?? undefined,
      listStyle: a(s, ODF.style, 'list-style-name') ?? undefined
    }
  }

  /** Named ODF paragraph style → our style id. */
  idFor(name: string | undefined): string | null {
    if (!name) return null
    const st = this.styles.get(name)
    const display = (st?.display ?? decodeName(name)).trim()
    const h = /^heading (\d)$/i.exec(display)
    if (h) return `Heading${h[1]}`
    if (/^contents (\d)$/i.test(display)) return null
    return BUILTIN[display.toLowerCase()] ?? display.replace(/[^A-Za-z0-9_-]/g, '_')
  }

  registerNamed(st: OdfStyle) {
    const id = this.idFor(st.name)
    if (!id) return
    const { breakBefore: _b, rtl: _r, shading: _s, ...para } = st.para
    const { highlight: _h, vert: _v, dstrike: _d, ...run } = st.run
    const outline = st.outline ?? (/^Heading(\d)$/.exec(id) ? Number(id.slice(7)) : undefined)
    this.docStyles[id] = {
      id,
      name: id === 'Normal' ? 'Normal' : st.display ?? decodeName(st.name),
      type: 'paragraph',
      basedOn: id === 'Normal' ? undefined : this.idFor(st.parent) ?? 'Normal',
      run,
      para: { ...para, ...(_b ? { pageBreakBefore: true } : {}) },
      outline,
      builtin: /^(Normal|Title|Subtitle|Heading\d|Quote|Caption)$/.test(id)
    } satisfies StyleDef
  }

  /** Effective (merged) style chain for an automatic or named style. */
  chain(name: string | undefined): OdfStyle[] {
    const out: OdfStyle[] = []
    const seen = new Set<string>()
    for (let s = name ? this.styles.get(name) : undefined; s && !seen.has(s.name); s = s.parent ? this.styles.get(s.parent) : undefined) {
      out.unshift(s)
      seen.add(s.name)
    }
    return out
  }

  /** Nearest named (non-automatic) ancestor of a paragraph style. */
  namedOf(name: string | undefined, auto: Set<string>): string | undefined {
    let n = name
    while (n && auto.has(n)) n = this.styles.get(n)?.parent
    return n
  }

  autoNames = new Set<string>()

  marksFrom(run: OdfStyle['run']): Mark[] {
    const m: Mark[] = []
    if (run.bold) m.push({ type: 'bold' })
    if (run.italic) m.push({ type: 'italic' })
    if (run.underline) m.push({ type: 'underline' })
    if (run.strike) m.push({ type: 'strike' })
    if (run.dstrike) m.push({ type: 'doubleStrike' })
    if (run.vert === 'super') m.push({ type: 'superscript' })
    if (run.vert === 'sub') m.push({ type: 'subscript' })
    if (run.highlight) m.push({ type: 'highlight', attrs: { color: run.highlight } })
    const ts: Record<string, unknown> = {}
    if (run.fontFamily) ts.fontFamily = run.fontFamily
    if (run.fontSize) ts.fontSize = `${run.fontSize}pt`
    if (run.color) ts.color = run.color
    if (run.letterSpacing) ts.letterSpacing = run.letterSpacing
    if (run.caps) ts.caps = true
    if (run.smallCaps) ts.smallCaps = true
    if (Object.keys(ts).length) m.push({ type: 'textStyle', attrs: ts })
    return m
  }

  /** Marks for direct (automatic) text formatting of a span style. */
  spanMarks(name: string | null): Mark[] {
    if (!name) return []
    const merged: OdfStyle['run'] = {}
    for (const s of this.chain(name)) Object.assign(merged, s.run)
    return this.marksFrom(merged)
  }

  // ---------- content ----------
  dataUrl(href: string): string | null {
    const bytes = this.files[href.replace(/^\.\//, '')]
    if (!bytes) return null
    const mime = mimeFromExt(href.split('.').pop() ?? '')
    if (/emf|wmf|tiff|octet/.test(mime)) return null
    return `data:${mime};base64,${toBase64(bytes)}`
  }

  inlines(el: El, marks: Mark[], out: JSONContent[]) {
    const withComments = (m: Mark[]) => [...m, ...[...this.activeComments].map((id) => ({ type: 'comment', attrs: { id } }))]
    const text = (t: string, m: Mark[]) => {
      if (!t) return
      const mm = withComments(m)
      out.push(mm.length ? { type: 'text', text: t, marks: mm.map((x) => ({ ...x })) } : { type: 'text', text: t })
    }
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        text((n.nodeValue ?? '').replace(/\s+/g, ' '), marks)
        continue
      }
      if (n.nodeType !== 1) continue
      const e = n as El
      if (e.namespaceURI === ODF.text) {
        switch (e.localName) {
          case 'span':
            this.inlines(e, [...marks, ...this.spanMarks(a(e, ODF.text, 'style-name'))], out)
            continue
          case 's':
            text(' '.repeat(Number(a(e, ODF.text, 'c') ?? 1)), marks)
            continue
          case 'tab':
            text('\t', marks)
            continue
          case 'line-break':
            out.push({ type: 'hardBreak' })
            continue
          case 'a': {
            const href = a(e, ODF.xlink, 'href')
            this.inlines(e, href ? [...marks, { type: 'link', attrs: { href } }] : marks, out)
            continue
          }
          case 'note': {
            const kind = a(e, ODF.text, 'note-class') === 'endnote' ? 'endnote' : 'footnote'
            const body = child(e, ODF.text, 'note-body')
            const saved = new Set(this.activeComments)
            this.activeComments.clear()
            out.push({ type: 'footnote', attrs: { kind, content: this.blocks(body) } })
            this.activeComments = saved
            continue
          }
          case 'page-number':
          case 'page-count':
          case 'date':
          case 'title':
          case 'initial-creator':
          case 'author-name': {
            const kind = { 'page-number': 'page', 'page-count': 'pages', date: 'date', title: 'title', 'initial-creator': 'author', 'author-name': 'author' }[e.localName]!
            if (this.inHF) out.push({ type: 'field', attrs: { kind } })
            else text(textOf(e), marks)
            continue
          }
          case 'bookmark':
          case 'bookmark-start':
          case 'bookmark-end':
          case 'soft-page-break':
          case 'reference-mark':
          case 'reference-mark-start':
          case 'reference-mark-end':
          case 'alphabetical-index-mark':
          case 'toc-mark':
            continue
          case 'change-start':
          case 'change-end':
          case 'change':
            this.w.add('loss', 'Tracked changes in this ODT file are shown as accepted')
            continue
          default:
            // Other fields (sequence, chapter, reference…): keep their text.
            text(textOf(e), marks)
            continue
        }
      }
      if (is(e, ODF.office, 'annotation')) {
        this.annotation(e)
        continue
      }
      if (is(e, ODF.office, 'annotation-end')) {
        const id = this.commentByName.get(a(e, ODF.office, 'name') ?? '')
        if (id) this.activeComments.delete(id)
        continue
      }
      if (is(e, ODF.draw, 'frame')) {
        const img = child(e, ODF.draw, 'image')
        const src = img ? this.dataUrl(a(img, ODF.xlink, 'href') ?? '') : null
        if (src) {
          const w = lenPt(a(e, ODF.svg, 'width'))
          const h = lenPt(a(e, ODF.svg, 'height'))
          const st = this.styles.get(a(e, ODF.draw, 'style-name') ?? '')
          const anchor = a(e, ODF.text, 'anchor-type')
          let float: string | null = null
          if (anchor !== 'as-char' && st?.wrap && st.wrap !== 'none' && st.wrap !== 'run-through') float = st.hpos === 'right' ? 'right' : 'left'
          this.imageCount++
          out.push({ type: 'image', attrs: { src, alt: textOf(child(e, ODF.svg, 'desc')) || null, title: textOf(child(e, ODF.svg, 'title')) || null, width: w ? Math.round(w / 0.75) : null, height: h ? Math.round(h / 0.75) : null, float } })
        } else {
          out.push({ type: 'preservedInline', attrs: { format: 'odt', label: child(e, ODF.draw, 'text-box') ? 'Text box' : 'Drawing', raw: serialize(e), text: textOf(e).replace(/\s+/g, ' ').trim().slice(0, 400) } })
          this.w.add('loss', 'Text boxes and drawings are preserved but not editable yet')
        }
        continue
      }
      out.push({ type: 'preservedInline', attrs: { format: 'odt', label: e.localName, raw: serialize(e), text: textOf(e).replace(/\s+/g, ' ').trim().slice(0, 400) } })
      this.w.add('loss', `Unsupported element <${e.localName}> preserved`)
    }
  }

  annotation(e: El) {
    const name = a(e, ODF.office, 'name')
    const author = textOf(kids(e).find((c) => is(c, ODF.dc, 'creator'))) || 'Author'
    const date = textOf(kids(e).find((c) => is(c, ODF.dc, 'date')))
    const body = kids(e)
      .filter((c) => is(c, ODF.text, 'p') || is(c, ODF.text, 'list'))
      .map(textOf)
      .join('\n')
      .trim()
    const parent = a(e, ODF.loext, 'parent-name')
    if (parent && this.commentByName.has(parent)) {
      this.comments[this.commentByName.get(parent)!].replies.push({ author, date, text: body })
      return
    }
    const id = `c${Object.keys(this.comments).length + 1}`
    this.comments[id] = { author, date, text: body, resolved: a(e, ODF.loext, 'resolved') === 'true', replies: [] }
    if (name) {
      this.commentByName.set(name, id)
      this.activeComments.add(id)
    } else this.w.add('info', 'Comments attached to a single point are listed but not highlighted')
  }

  paragraph(p: El, heading: boolean, out: JSONContent[]) {
    const styleName = a(p, ODF.text, 'style-name') ?? undefined
    const chain = this.chain(styleName)
    const named = this.namedOf(styleName, this.autoNames)
    const id = this.idFor(named) ?? 'Normal'
    // Direct formatting = properties of the automatic styles above the named one.
    const direct: OdfStyle['para'] = {}
    const directRun: OdfStyle['run'] = {}
    for (const s of chain) if (this.autoNames.has(s.name)) Object.assign(direct, s.para), Object.assign(directRun, s.run)
    const content: JSONContent[] = []
    this.inlines(p, this.marksFrom(directRun), content)
    const outlineAttr = a(p, ODF.text, 'outline-level')
    let level = heading ? Number(outlineAttr ?? 1) : 0
    if (!level) {
      const h = /^Heading(\d)$/.exec(id)
      if (h) level = Number(h[1])
    }
    const attrs: Record<string, unknown> = {}
    for (const k of ['align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indentLeft', 'indentRight', 'indentFirst', 'keepNext', 'keepLines'] as const) if (direct[k] != null) attrs[k] = direct[k]
    if (direct.shading) attrs.shading = direct.shading
    if (direct.rtl) attrs.dir = 'rtl'
    // A page break in direct formatting (LibreOffice's "Insert page break") becomes a page-break node.
    if (direct.breakBefore) out.push({ type: 'pageBreak' })
    const node: JSONContent =
      level && level <= 9
        ? { type: 'heading', attrs: { level, ...attrs, styleId: /^Heading\d$/.test(id) ? null : id } }
        : { type: 'paragraph', attrs: { ...attrs, styleId: id === 'Normal' ? null : id } }
    const merged = mergeText(content)
    if (merged.length) node.content = merged
    out.push(node)
  }

  list(el: El, depth: number, styleName: string | undefined, out: JSONContent[]) {
    const ls = a(el, ODF.text, 'style-name') ?? styleName
    const levels = (ls && this.lists.get(ls)) || []
    const lv = levels[Math.min(depth, levels.length - 1)] ?? { bullet: true, char: '•', format: '1', start: 1, levels: 1 }
    const items: JSONContent[] = []
    for (const li of kids(el)) {
      if (!is(li, ODF.text, 'list-item') && !is(li, ODF.text, 'list-header')) continue
      const blocks: JSONContent[] = []
      for (const c of kids(li)) {
        if (is(c, ODF.text, 'list')) this.list(c, depth + 1, ls, blocks)
        else this.block(c, blocks)
      }
      while (blocks[0] && blocks[0].type !== 'paragraph' && blocks[0].type !== 'heading') blocks.shift()
      if (!blocks.length) blocks.push({ type: 'paragraph' })
      if (blocks[0].type === 'heading') blocks[0] = { ...blocks[0], type: 'paragraph', attrs: { ...blocks[0].attrs, level: undefined } }
      items.push({ type: 'listItem', content: blocks })
    }
    if (!items.length) return
    // Task lists (written by us as ☐/☒ prefixes).
    const first = (it: JSONContent) => it.content?.[0]?.content?.[0]
    if (items.every((it) => /^[☐☒] /.test(first(it)?.text ?? ''))) {
      out.push({
        type: 'taskList',
        content: items.map((it) => {
          const t = first(it)!
          const checked = t.text!.startsWith('☒')
          t.text = t.text!.slice(2)
          if (!t.text) it.content![0].content!.shift()
          return { type: 'taskItem', attrs: { checked }, content: it.content }
        })
      })
      return
    }
    if (lv.bullet) {
      const char = lv.char.replace(/\s/g, '') || '•'
      out.push({ type: 'bulletList', attrs: { bullet: ['•', '◦', '▪'].includes(char) ? null : char }, content: items })
      return
    }
    const key = `${ls}|${depth}`
    const cont = a(el, ODF.text, 'continue-numbering') === 'true' || !!a(el, ODF.text, 'continue-list')
    const start = cont ? (this.counters.get(key) ?? lv.start - 1) + 1 : lv.start
    this.counters.set(key, start + items.length - 1)
    const fmt = ['1', 'a', 'A', 'i', 'I'].includes(lv.format) ? lv.format : '1'
    out.push({ type: 'orderedList', attrs: { start, type: lv.levels > 1 ? '1.1' : fmt }, content: items })
  }

  table(el: El): JSONContent {
    const widths: number[] = []
    const rows: { header: boolean; el: El }[] = []
    const collect = (c: El, header: boolean) => {
      for (const r of kids(c)) {
        if (is(r, ODF.table, 'table-column')) {
          const n = Number(a(r, ODF.table, 'number-columns-repeated') ?? 1)
          const w = this.styles.get(a(r, ODF.table, 'style-name') ?? '')?.colWidth
          for (let i = 0; i < n; i++) widths.push(w ? Math.round(w / 0.75) : 0)
        } else if (is(r, ODF.table, 'table-row')) rows.push({ header, el: r })
        else if (is(r, ODF.table, 'table-header-rows')) collect(r, true)
        else if (is(r, ODF.table, 'table-rows') || is(r, ODF.table, 'table-columns') || is(r, ODF.table, 'table-header-columns') || is(r, ODF.table, 'table-row-group') || is(r, ODF.table, 'table-column-group')) collect(r, header)
      }
    }
    collect(el, false)
    const content = rows.map((r) => {
      let col = 0
      const cells: JSONContent[] = []
      for (const c of kids(r.el)) {
        const repeat = Number(a(c, ODF.table, 'number-columns-repeated') ?? 1)
        if (is(c, ODF.table, 'covered-table-cell')) {
          col += repeat
          continue
        }
        if (!is(c, ODF.table, 'table-cell')) continue
        const span = Number(a(c, ODF.table, 'number-columns-spanned') ?? 1)
        const rowspan = Number(a(c, ODF.table, 'number-rows-spanned') ?? 1)
        const st = this.styles.get(a(c, ODF.table, 'style-name') ?? '')
        const blocks = this.blocks(c)
        for (let k = 0; k < Math.min(repeat, 50); k++) {
          const cw = widths.slice(col, col + span)
          cells.push({
            type: r.header ? 'tableHeader' : 'tableCell',
            attrs: { colspan: span, rowspan, colwidth: cw.length === span && cw.every((x) => x > 0) ? cw : null, background: st?.cellBg ?? null, verticalAlign: st?.valign === 'middle' ? 'middle' : st?.valign === 'bottom' ? 'bottom' : null },
            content: blocks.length ? structuredClone(blocks) : [{ type: 'paragraph' }]
          })
          col += span
        }
      }
      return { type: 'tableRow', content: cells.length ? cells : [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }
    })
    return { type: 'table', content }
  }

  toc(el: El, out: JSONContent[]) {
    const body = child(el, ODF.text, 'index-body')
    const src = child(el, ODF.text, 'table-of-content-source')
    const max = Number(a(src, ODF.text, 'outline-level') ?? 3)
    const entries: JSONContent[] = []
    for (const p of kids(body)) {
      if (is(p, ODF.text, 'index-title')) {
        const t = kids(p).map(textOf).join(' ').trim()
        if (t) out.push({ type: 'paragraph', attrs: { styleId: 'TOCHeading' }, content: [{ type: 'text', text: t }] })
        continue
      }
      if (!is(p, ODF.text, 'p')) continue
      const st = this.styles.get(a(p, ODF.text, 'style-name') ?? '')
      const display = st?.display ?? decodeName(this.namedOf(st?.name, this.autoNames) ?? st?.name ?? '')
      const level = Number(/(\d)\s*$/.exec(display)?.[1] ?? 1)
      // title<tab>page
      let text = ''
      let page = ''
      let afterTab = false
      const walk = (n: Node) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) afterTab ? (page += c.nodeValue) : (text += c.nodeValue)
          else if (c.nodeType === 1 && (c as El).localName === 'tab') {
            if (afterTab) text += page
            afterTab = true
            page = ''
          } else if (c.nodeType === 1) walk(c)
        }
      }
      walk(p)
      if (!afterTab) text += page
      entries.push({ type: 'tocEntry', attrs: { level, page: page.trim(), target: null }, content: text.trim() ? [{ type: 'text', text: text.trim() }] : undefined })
    }
    if (entries.length) out.push({ type: 'toc', attrs: { maxLevel: max }, content: entries })
  }

  block(e: El, out: JSONContent[]) {
    if (is(e, ODF.text, 'p')) this.paragraph(e, false, out)
    else if (is(e, ODF.text, 'h')) this.paragraph(e, true, out)
    else if (is(e, ODF.text, 'list')) this.list(e, 0, undefined, out)
    else if (is(e, ODF.table, 'table')) {
      const st = this.styles.get(a(e, ODF.table, 'style-name') ?? '')
      if (st?.para.breakBefore) out.push({ type: 'pageBreak' })
      out.push(this.table(e))
    } else if (is(e, ODF.text, 'table-of-content')) this.toc(e, out)
    else if (is(e, ODF.text, 'section')) {
      if (this.styles.get(a(e, ODF.text, 'style-name') ?? '')) this.w.add('info', 'Section formatting (such as columns) is not kept')
      for (const c of kids(e)) this.block(c, out)
    } else if (is(e, ODF.text, 'soft-page-break') || is(e, ODF.text, 'sequence-decls') || is(e, ODF.text, 'variable-decls') || is(e, ODF.text, 'user-field-decls') || is(e, ODF.office, 'forms') || is(e, ODF.text, 'tracked-changes') || is(e, ODF.text, 'bookmark') || is(e, ODF.text, 'bookmark-start') || is(e, ODF.text, 'bookmark-end')) {
      if (is(e, ODF.text, 'tracked-changes') && kids(e).length) this.w.add('loss', 'Tracked changes in this ODT file are shown as accepted')
    } else {
      out.push({ type: 'preservedBlock', attrs: { format: 'odt', label: e.localName, raw: serialize(e), text: textOf(e).replace(/\s+/g, ' ').trim().slice(0, 400) } })
      this.w.add('loss', `Unsupported block <${e.localName}> preserved`)
    }
  }

  blocks(container: El | null): JSONContent[] {
    const out: JSONContent[] = []
    for (const e of kids(container)) this.block(e, out)
    return out
  }
}

function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev?.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) prev.text += n.text ?? ''
    else out.push({ ...n })
  }
  // Collapse whitespace across adjacent runs, as ODF rendering does.
  for (let i = 0; i < out.length; i++) {
    const n = out[i]
    if (n.type !== 'text') continue
    const prev = out[i - 1]
    if ((i === 0 || (prev?.type === 'text' && /\s$/.test(prev.text ?? ''))) && n.text!.startsWith(' ') && !n.text!.startsWith('  ')) n.text = n.text!.replace(/^ /, '')
  }
  return out.filter((n) => n.type !== 'text' || n.text)
}

export function importOdt(data: Uint8Array): ImportResult {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('This file is not a valid ODT package (it may be damaged or password-protected).')
  }
  if (files['mimetype'] && !strFromU8(files['mimetype']).includes('opendocument.text')) throw new Error('This OpenDocument file is not a text document.')
  if (!files['content.xml']) throw new Error('The ODT package has no content.')
  if (files['META-INF/manifest.xml'] && /manifest:encryption-data/.test(strFromU8(files['META-INF/manifest.xml']))) throw new Error('This ODT file is password-protected.')
  const r = new OdtReader(files)
  const content = parseXml(strFromU8(files['content.xml'])).documentElement
  const styles = files['styles.xml'] ? parseXml(strFromU8(files['styles.xml'])).documentElement : null

  for (const root of [styles, content]) {
    const ffd = kids(root).find((c) => is(c, ODF.office, 'font-face-decls'))
    for (const f of kids(ffd)) {
      const name = a(f, ODF.style, 'name')
      const fam = a(f, ODF.svg, 'font-family')
      if (name && fam) r.fonts.set(name, fam.replace(/^['"]|['"]$/g, ''))
    }
  }
  const stylesAuto = kids(styles).find((c) => is(c, ODF.office, 'automatic-styles')) ?? null
  const contentAuto = kids(content).find((c) => is(c, ODF.office, 'automatic-styles')) ?? null
  for (const s of [...kids(stylesAuto), ...kids(contentAuto)]) if (is(s, ODF.style, 'style')) r.autoNames.add(a(s, ODF.style, 'name') ?? '')
  r.readStyles(kids(styles).find((c) => is(c, ODF.office, 'styles')) ?? null, false)
  r.readStyles(stylesAuto, true)
  r.readStyles(contentAuto, true)
  // Defaults feed "Normal".
  const def = r.styles.get('__default')
  if (def) {
    const { highlight: _h, vert: _v, dstrike: _d, ...run } = def.run
    const { breakBefore: _b, rtl: _r, shading: _s, ...para } = def.para
    const normal = r.docStyles.Normal
    r.docStyles.Normal = { id: 'Normal', name: 'Normal', type: 'paragraph', builtin: true, run: { ...run, ...normal?.run }, para: { ...para, ...normal?.para } }
  }

  // Page layout + headers/footers from the first master page.
  const master = kids(kids(styles).find((c) => is(c, ODF.office, 'master-styles'))).find((c) => is(c, ODF.style, 'master-page'))
  const layout = kids(stylesAuto).find((c) => is(c, ODF.style, 'page-layout') && a(c, ODF.style, 'name') === a(master, ODF.style, 'page-layout-name'))
  const page = makePageSetup()
  let hf: HeadersFooters | null = null
  if (layout) {
    const lp = child(layout, ODF.style, 'page-layout-properties')
    const w = lenPt(a(lp, ODF.fo, 'page-width'))
    const h = lenPt(a(lp, ODF.fo, 'page-height'))
    if (w && h) {
      page.width = w
      page.height = h
      page.orientation = a(lp, ODF.style, 'print-orientation') === 'landscape' || w > h ? 'landscape' : 'portrait'
      const [pw, ph] = page.orientation === 'landscape' ? [h, w] : [w, h]
      page.size = (Object.entries(PAGE_SIZES).find(([, s]) => Math.abs(s.width - pw) < 3 && Math.abs(s.height - ph) < 3)?.[0] as PageSetup['size']) ?? 'custom'
    }
    const m = (k: string) => lenPt(a(lp, ODF.fo, `margin-${k}`))
    page.margins = { ...page.margins, top: m('top') ?? 72, bottom: m('bottom') ?? 72, left: m('left') ?? 72, right: m('right') ?? 72 }
    const fmt = a(lp, ODF.style, 'num-format')
    if (fmt && fmt !== '1' && ['i', 'I', 'a', 'A'].includes(fmt)) page.numbering = { format: fmt as PageNumberFormat, start: 1 }
    const bg = color(a(lp, ODF.fo, 'background-color'))
    if (bg && bg !== '#ffffff') page.background = bg
    // ODF margins exclude the header/footer; our model measures the body from the page edge.
    const hdr = child(child(layout, ODF.style, 'header-style'), ODF.style, 'header-footer-properties')
    const ftr = child(child(layout, ODF.style, 'footer-style'), ODF.style, 'header-footer-properties')
    const hasHeader = !!master && !!child(master, ODF.style, 'header')
    const hasFooter = !!master && !!child(master, ODF.style, 'footer')
    if (hasHeader) {
      page.margins.header = page.margins.top
      page.margins.top += (lenPt(a(hdr, ODF.fo, 'min-height')) ?? 14) + (lenPt(a(hdr, ODF.fo, 'margin-bottom')) ?? 14)
    }
    if (hasFooter) {
      page.margins.footer = page.margins.bottom
      page.margins.bottom += (lenPt(a(ftr, ODF.fo, 'min-height')) ?? 14) + (lenPt(a(ftr, ODF.fo, 'margin-top')) ?? 14)
    }
  }
  if (master) {
    r.inHF = true
    hf = { header: {}, footer: {}, differentFirst: false, differentOddEven: false }
    for (const kind of ['header', 'footer'] as const) {
      const main = child(master, ODF.style, kind)
      const left = child(master, ODF.style, `${kind}-left`)
      const first = child(master, ODF.style, `${kind}-first`) ?? child(master, ODF.loext, `${kind}-first`)
      if (main && a(main, ODF.style, 'display') !== 'false') hf[kind].default = r.blocks(main)
      if (left && a(left, ODF.style, 'display') !== 'false') {
        hf[kind].even = r.blocks(left)
        hf.differentOddEven = true
      }
      if (first && a(first, ODF.style, 'display') !== 'false') {
        hf[kind].first = r.blocks(first)
        hf.differentFirst = true
      }
    }
    r.inHF = false
    if (!hf.header.default && !hf.footer.default && !hf.differentFirst && !hf.differentOddEven) hf = null
  }

  const text = kids(kids(content).find((c) => is(c, ODF.office, 'body'))).find((c) => is(c, ODF.office, 'text')) ?? null
  if (!text) throw new Error('The ODT document body is missing.')
  const body = r.blocks(text)

  const meta: DocMeta = {}
  if (files['meta.xml']) {
    const md = kids(kids(parseXml(strFromU8(files['meta.xml'])).documentElement).find((c) => is(c, ODF.office, 'meta')))
    const get = (ns: string, n: string) => textOf(md.find((c) => is(c, ns, n))).trim() || undefined
    Object.assign(meta, { title: get(ODF.dc, 'title'), subject: get(ODF.dc, 'subject'), author: get(ODF.meta, 'initial-creator') ?? get(ODF.dc, 'creator'), keywords: get(ODF.meta, 'keyword'), description: get(ODF.dc, 'description'), created: get(ODF.meta, 'creation-date'), modified: get(ODF.dc, 'date') })
  }

  return {
    doc: { type: 'doc', attrs: { page, styles: r.docStyles, meta, hf, comments: Object.keys(r.comments).length ? r.comments : null }, content: body.length ? body : [{ type: 'paragraph' }] },
    warnings: r.w.list()
  }
}
