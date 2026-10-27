import { unzipSync, strFromU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { makePageSetup, PAGE_SIZES, type DocMeta, type HeadersFooters, type PageNumberFormat, type PageSetup, type ParaProps, type RunProps, type StyleDef, type StyleMap } from '@/editor/model'
import { Warnings, type ImportResult } from '../types'
import type { CommentMap } from '@/editor/comments'
import { NS, attr, child, children, elements, find, findAll, is, mimeFromExt, num, onOff, parseXml, serialize, textOf, toBase64, wval, type El } from './xml'

// DOCX (WordprocessingML) → editor JSON. Unsupported elements are kept verbatim as
// preserved nodes and every part we do not regenerate travels in `carry` so saving
// writes it back.

export interface Rel {
  id: string
  type: string
  target: string
  external: boolean
}

export interface DocxCarry {
  /** Original package parts by path (e.g. "word/header1.xml"). */
  parts: Record<string, Uint8Array>
  /** document.xml relationships. */
  rels: Rel[]
  /** Raw XML for sectPr children we do not model (header/footer references, titlePg…). */
  sectPrExtra: string
  /** Original content-type overrides by part name. */
  overrides: Record<string, string>
  /** Parts converted into the editor model (headers/footers); regenerated, never copied. */
  converted?: string[]
}

type Mark = { type: string; attrs?: Record<string, unknown> }

interface Numbering {
  /** numId → level → definition */
  get(numId: string, ilvl: number): LevelDef | null
}

interface LevelDef {
  fmt: string
  text: string
  start: number
  font?: string
}

const twipToPt = (v: number | null) => (v == null ? null : Math.round((v / 20) * 100) / 100)
const emuToPx = (v: number | null) => (v == null ? null : Math.round(v / 9525))

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
  white: '#ffffff'
}
export const HIGHLIGHT_NAMES = HIGHLIGHT

const BUILTIN_BY_NAME: Record<string, string> = {
  normal: 'Normal',
  title: 'Title',
  subtitle: 'Subtitle',
  quote: 'Quote',
  caption: 'Caption',
  'no spacing': 'NoSpacing',
  'list paragraph': 'ListParagraph',
  'intense quote': 'IntenseQuote'
}

/** Map Word symbol-font code points (PUA) to Unicode. */
const SYMBOL_BULLETS: Record<string, string> = { '': '•', '': '▪', '': '➢', '': '✓', '': '❖', '': '◆', '': '◦', o: '◦', '§': '▪', '·': '•' }

function decodeBullet(text: string, font?: string): string {
  if (!text) return '•'
  if (SYMBOL_BULLETS[text]) return SYMBOL_BULLETS[text]
  if (/symbol|wingdings/i.test(font ?? '') && text.charCodeAt(0) >= 0xf000) return '•'
  if (/symbol|wingdings/i.test(font ?? '') && text === 'q') return '❑'
  return text
}

class Reader {
  w = new Warnings()
  rels = new Map<string, Rel>()
  styles: StyleMap = {}
  /** Word styleId → our style id (normalized built-ins). */
  styleIdMap = new Map<string, string>()
  headingLevel = new Map<string, number>()
  paraStyleNum = new Map<string, { numId: string; ilvl: number }>()
  charStyles = new Map<string, RunProps & { extra: Mark[] }>()
  numbering: Numbering = { get: () => null }
  themeFonts = { major: 'Calibri Light', minor: 'Calibri' }
  counters = new Map<string, number[]>()
  imageCount = 0
  /** Parsing a header/footer: page-number style fields become live field nodes. */
  inHF = false
  tocLevel = new Map<string, number>()
  notes = { footnote: new Map<string, JSONContent[]>(), endnote: new Map<string, JSONContent[]>() }
  comments: CommentMap = {}
  /** Word comment id → our thread id (replies map to their parent thread). */
  commentIds = new Map<string, string>()
  replyIds = new Set<string>()
  activeComments = new Set<string>()
  commentParts: string[] = []

  commentRange(e: El) {
    const wid = attr(e, NS.w, 'id') ?? ''
    if (this.replyIds.has(wid)) return
    const id = this.commentIds.get(wid)
    if (!id) return
    if (e.localName === 'commentRangeStart') this.activeComments.add(id)
    else this.activeComments.delete(id)
  }

  /** comments.xml (+ commentsExtended.xml for threads/resolved) → comment threads. */
  loadComments() {
    const rel = [...this.rels.values()].find((x) => x.type.endsWith('/comments'))
    const xml = rel && !rel.external ? this.text(rel.target) : null
    if (!rel || !xml) return
    this.commentParts.push(rel.target)
    const extRel = [...this.rels.values()].find((x) => x.type.endsWith('/commentsExtended'))
    const ext = new Map<string, { parent: string | null; done: boolean }>()
    const extXml = extRel && this.text(extRel.target)
    if (extRel && extXml) {
      this.commentParts.push(extRel.target)
      for (const c of elements(parseXml(extXml).documentElement))
        ext.set(c.getAttribute('w15:paraId') ?? '', { parent: c.getAttribute('w15:paraIdParent') || null, done: c.getAttribute('w15:done') === '1' })
    }
    for (const r of this.rels.values()) if (/\/(commentsIds|commentsExtensible)$/.test(r.type)) this.commentParts.push(r.target)
    const byPara = new Map<string, string>()
    const list = children(parseXml(xml).documentElement, NS.w, 'comment').map((c) => {
      const paras = children(c, NS.w, 'p')
      const lastPara = paras[paras.length - 1]
      const paraId = lastPara ? (lastPara.getAttributeNS(NS.w14, 'paraId') ?? '') : ''
      return {
        wid: attr(c, NS.w, 'id') ?? '',
        author: attr(c, NS.w, 'author') ?? 'Author',
        date: attr(c, NS.w, 'date') ?? '',
        text: paras.map((p) => findAll(p, NS.w, 't').map(textOf).join('')).join('\n').trim(),
        paraId
      }
    })
    for (const c of list) {
      const meta = ext.get(c.paraId)
      if (meta?.parent && byPara.has(meta.parent)) {
        const parentId = byPara.get(meta.parent)!
        this.comments[parentId].replies.push({ author: c.author, date: c.date, text: c.text })
        this.replyIds.add(c.wid)
        continue
      }
      const id = `c${c.wid}`
      this.commentIds.set(c.wid, id)
      if (c.paraId) byPara.set(c.paraId, id)
      this.comments[id] = { author: c.author, date: c.date, text: c.text, resolved: !!meta?.done, replies: [] }
    }
  }
  noteParts: string[] = []

  /** Read footnotes.xml / endnotes.xml into editable content keyed by note id. */
  loadNotes() {
    for (const kind of ['footnote', 'endnote'] as const) {
      const rel = [...this.rels.values()].find((x) => x.type.endsWith(`/${kind}s`))
      const xml = rel && !rel.external ? this.text(rel.target) : null
      if (!rel || !xml) continue
      this.noteParts.push(rel.target)
      const saved = this.rels
      this.rels = this.relsFor(rel.target)
      for (const n of children(parseXml(xml).documentElement, NS.w, kind)) {
        const type = attr(n, NS.w, 'type')
        if (type && type !== 'normal') continue
        const blocks = this.blocks(n)
        // Drop the leading space Word puts after the note mark.
        const first = blocks[0]?.content?.[0]
        if (first?.type === 'text' && first.text) first.text = first.text.replace(/^\s+/, '')
        if (first?.type === 'text' && !first.text) blocks[0].content!.shift()
        for (const b of blocks) if (b.attrs?.styleId && /^(FootnoteText|EndnoteText)$/i.test(String(b.attrs.styleId))) b.attrs.styleId = null
        this.notes[kind].set(attr(n, NS.w, 'id') ?? '', blocks)
      }
      this.rels = saved
    }
  }

  /** A Word TOC content control → our toc node (entries keep their text and cached page numbers). */
  tocBlock(sdt: El): JSONContent[] {
    const before: JSONContent[] = []
    const entries: JSONContent[] = []
    let max = 3
    for (const p of findAll(child(sdt, NS.w, 'sdtContent'), NS.w, 'p')) {
      const style = wval(child(child(p, NS.w, 'pPr'), NS.w, 'pStyle'))
      const level = style ? this.tocLevel.get(style) : undefined
      const instr = findAll(p, NS.w, 'instrText').map(textOf).join('')
      const m = /\\o\s*"\d+-(\d+)"/.exec(instr)
      if (m) max = Number(m[1])
      const full = findAll(p, NS.w, 't').map(textOf).join('').trim()
      if (!level) {
        if (full) before.push({ type: 'paragraph', attrs: { styleId: style ? this.normId(style) : 'TOCHeading' }, content: [{ type: 'text', text: full }] })
        continue
      }
      // Text before the last tab is the title; after it, the cached page number.
      const runs = findAll(p, NS.w, 'r').filter((r) => !findAll(r, NS.w, 'instrText').length)
      let text = ''
      let page = ''
      let afterTab = false
      for (const r of runs) {
        for (const e of elements(r)) {
          if (is(e, NS.w, 'tab')) {
            if (afterTab) text += page
            afterTab = true
            page = ''
          } else if (is(e, NS.w, 't')) {
            if (afterTab) page += textOf(e)
            else text += textOf(e)
          }
        }
      }
      if (!afterTab) text += page
      entries.push({ type: 'tocEntry', attrs: { level, page: page.trim(), target: null }, content: text.trim() ? [{ type: 'text', text: text.trim() }] : undefined })
    }
    if (!entries.length) return [...before, ...this.blocks(child(sdt, NS.w, 'sdtContent')!)]
    return [...before, { type: 'toc', attrs: { maxLevel: max }, content: entries }]
  }

  constructor(
    public files: Record<string, Uint8Array>,
    public docPath: string
  ) {}

  text(path: string): string | null {
    const f = this.files[path]
    return f ? strFromU8(f) : null
  }

  // ---------- relationships ----------
  loadRels() {
    this.rels = this.relsFor(this.docPath)
  }

  relsFor(partPath: string): Map<string, Rel> {
    const out = new Map<string, Rel>()
    const dir = partPath.replace(/[^/]+$/, '')
    const relsXml = this.text(`${dir}_rels/${partPath.slice(dir.length)}.rels`)
    if (!relsXml) return out
    for (const r of elements(parseXml(relsXml).documentElement)) {
      const id = attr(r, null, 'Id')
      if (!id) continue
      const external = attr(r, null, 'TargetMode') === 'External'
      let target = attr(r, null, 'Target') ?? ''
      if (!external) target = target.startsWith('/') ? target.slice(1) : normalizePath(dir + target)
      out.set(id, { id, type: attr(r, null, 'Type') ?? '', target, external })
    }
    return out
  }

  /** Parse header/footer parts referenced by the final section into editable content. */
  headersFooters(sectPr: El | null, evenAndOdd: boolean): { hf: HeadersFooters; parts: string[] } | null {
    if (!sectPr) return null
    const hf: HeadersFooters = { header: {}, footer: {}, differentFirst: onOff(child(sectPr, NS.w, 'titlePg')) ?? false, differentOddEven: evenAndOdd }
    const parts: string[] = []
    let any = false
    for (const kind of ['header', 'footer'] as const) {
      for (const ref of children(sectPr, NS.w, `${kind}Reference`)) {
        const rel = this.rels.get(attr(ref, NS.r, 'id') ?? '')
        const xml = rel && !rel.external ? this.text(rel.target) : null
        if (!rel || !xml) continue
        const type = (attr(ref, NS.w, 'type') ?? 'default') as 'default' | 'first' | 'even'
        const saved = this.rels
        this.rels = this.relsFor(rel.target)
        this.inHF = true
        const blocks = this.blocks(parseXml(xml).documentElement)
        this.inHF = false
        this.rels = saved
        parts.push(rel.target)
        const empty = blocks.every((b) => b.type === 'paragraph' && !b.content)
        if (!empty) any = true
        hf[kind][type] = empty ? null : blocks
      }
    }
    return any || parts.length ? { hf, parts } : null
  }

  // ---------- theme ----------
  loadTheme() {
    const rel = [...this.rels.values()].find((r) => r.type.endsWith('/theme'))
    const xml = rel && this.text(rel.target)
    if (!xml) return
    const doc = parseXml(xml)
    const major = find(find(doc, NS.a, 'majorFont'), NS.a, 'latin')
    const minor = find(find(doc, NS.a, 'minorFont'), NS.a, 'latin')
    if (major) this.themeFonts.major = attr(major, null, 'typeface') || this.themeFonts.major
    if (minor) this.themeFonts.minor = attr(minor, null, 'typeface') || this.themeFonts.minor
  }

  // ---------- properties ----------
  runProps(rPr: El | null): RunProps & { highlight?: string; vert?: string; dstrike?: boolean; rStyle?: string } {
    const p: RunProps & { highlight?: string; vert?: string; dstrike?: boolean; rStyle?: string } = {}
    if (!rPr) return p
    for (const e of elements(rPr)) {
      if (e.namespaceURI !== NS.w) continue
      switch (e.localName) {
        case 'rStyle':
          p.rStyle = wval(e) ?? undefined
          break
        case 'rFonts': {
          const f = attr(e, NS.w, 'ascii') ?? attr(e, NS.w, 'hAnsi') ?? attr(e, NS.w, 'cs')
          const theme = attr(e, NS.w, 'asciiTheme') ?? attr(e, NS.w, 'hAnsiTheme')
          if (f) p.fontFamily = f
          else if (theme) p.fontFamily = theme.startsWith('major') ? this.themeFonts.major : this.themeFonts.minor
          break
        }
        case 'b':
          p.bold = onOff(e) ?? undefined
          break
        case 'i':
          p.italic = onOff(e) ?? undefined
          break
        case 'u':
          p.underline = wval(e) !== 'none'
          break
        case 'strike':
          p.strike = onOff(e) ?? undefined
          break
        case 'dstrike':
          p.dstrike = onOff(e) ?? undefined
          break
        case 'caps':
          p.caps = onOff(e) ?? undefined
          break
        case 'smallCaps':
          p.smallCaps = onOff(e) ?? undefined
          break
        case 'sz': {
          const v = num(wval(e))
          if (v) p.fontSize = v / 2
          break
        }
        case 'color': {
          const v = wval(e)
          if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) p.color = `#${v.toLowerCase()}`
          break
        }
        case 'highlight': {
          const v = wval(e)
          if (v && HIGHLIGHT[v]) p.highlight = HIGHLIGHT[v]
          break
        }
        case 'shd': {
          const fill = attr(e, NS.w, 'fill')
          if (fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill) && !p.highlight) p.highlight = `#${fill.toLowerCase()}`
          break
        }
        case 'vertAlign':
          p.vert = wval(e) ?? undefined
          break
        case 'spacing': {
          const v = num(wval(e))
          if (v) p.letterSpacing = twipToPt(v)!
          break
        }
        case 'vanish':
          if (onOff(e)) this.w.add('info', 'Hidden text is shown as normal text')
          break
      }
    }
    return p
  }

  paraProps(pPr: El | null): ParaProps & { numPr?: { numId: string; ilvl: number } | null; outline?: number; contextual?: boolean } {
    const p: ParaProps & { numPr?: { numId: string; ilvl: number } | null; outline?: number; contextual?: boolean } = {}
    if (!pPr) return p
    for (const e of elements(pPr)) {
      if (e.namespaceURI !== NS.w) continue
      switch (e.localName) {
        case 'jc': {
          const v = wval(e)
          p.align = v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : v === 'both' || v === 'distribute' ? 'justify' : 'left'
          break
        }
        case 'spacing': {
          const before = num(attr(e, NS.w, 'before'))
          const after = num(attr(e, NS.w, 'after'))
          const line = num(attr(e, NS.w, 'line'))
          const rule = attr(e, NS.w, 'lineRule') ?? 'auto'
          if (before != null && attr(e, NS.w, 'beforeAutospacing') !== '1') p.spaceBefore = twipToPt(before)!
          if (after != null && attr(e, NS.w, 'afterAutospacing') !== '1') p.spaceAfter = twipToPt(after)!
          if (line != null) {
            if (rule === 'auto') p.lineHeight = Math.round((line / 240) * 100) / 100
            else {
              // exact / atLeast: approximate as a multiple of an 11pt line
              p.lineHeight = Math.max(0.6, Math.round((line / 20 / (11 * 1.2)) * 100) / 100)
              this.w.add('info', 'Exact line spacing is approximated as a multiple')
            }
          }
          break
        }
        case 'ind': {
          const left = num(attr(e, NS.w, 'left') ?? attr(e, NS.w, 'start'))
          const right = num(attr(e, NS.w, 'right') ?? attr(e, NS.w, 'end'))
          const first = num(attr(e, NS.w, 'firstLine'))
          const hanging = num(attr(e, NS.w, 'hanging'))
          if (left != null) p.indentLeft = twipToPt(left)!
          if (right != null) p.indentRight = twipToPt(right)!
          if (hanging != null) p.indentFirst = -twipToPt(hanging)!
          else if (first != null) p.indentFirst = twipToPt(first)!
          break
        }
        case 'keepNext':
          p.keepNext = onOff(e) ?? undefined
          break
        case 'keepLines':
          p.keepLines = onOff(e) ?? undefined
          break
        case 'pageBreakBefore':
          p.pageBreakBefore = onOff(e) ?? undefined
          break
        case 'contextualSpacing':
          p.contextual = onOff(e) ?? undefined
          break
        case 'outlineLvl': {
          const v = num(wval(e))
          if (v != null && v < 9) p.outline = v + 1
          break
        }
        case 'numPr': {
          const numId = wval(child(e, NS.w, 'numId'))
          const ilvl = num(wval(child(e, NS.w, 'ilvl'))) ?? 0
          p.numPr = numId && numId !== '0' ? { numId, ilvl } : null
          break
        }
      }
    }
    return p
  }

  // ---------- styles ----------
  normId(wordId: string): string {
    return this.styleIdMap.get(wordId) ?? wordId.replace(/[^A-Za-z0-9_-]/g, '_')
  }

  loadStyles() {
    const rel = [...this.rels.values()].find((r) => r.type.endsWith('/styles'))
    const xml = rel && this.text(rel.target)
    if (!xml) return
    const root = parseXml(xml).documentElement
    const all = children(root, NS.w, 'style')
    // first pass: id normalization
    for (const s of all) {
      const id = attr(s, NS.w, 'styleId')
      const name = (wval(child(s, NS.w, 'name')) ?? '').toLowerCase()
      if (!id) continue
      const tm = /^toc ([1-9])$/.exec(name)
      if (tm) {
        this.tocLevel.set(id, Number(tm[1]))
        this.styleIdMap.set(id, `TOC${tm[1]}`)
      }
      if (name === 'toc heading') this.styleIdMap.set(id, 'TOCHeading')
      const hm = /^heading ([1-9])$/.exec(name)
      if (hm) {
        this.styleIdMap.set(id, `Heading${hm[1]}`)
        this.headingLevel.set(id, Number(hm[1]))
      } else if (BUILTIN_BY_NAME[name]) this.styleIdMap.set(id, BUILTIN_BY_NAME[name])
      if (attr(s, NS.w, 'default') === '1' && attr(s, NS.w, 'type') === 'paragraph') this.styleIdMap.set(id, 'Normal')
    }
    // doc defaults
    const defaults = child(root, NS.w, 'docDefaults')
    const defRun = this.runProps(child(child(defaults, NS.w, 'rPrDefault'), NS.w, 'rPr'))
    const defPara = this.paraProps(child(child(defaults, NS.w, 'pPrDefault'), NS.w, 'pPr'))
    for (const s of all) {
      const type = attr(s, NS.w, 'type')
      const wid = attr(s, NS.w, 'styleId')
      if (!wid) continue
      const rp = this.runProps(child(s, NS.w, 'rPr'))
      const pp = this.paraProps(child(s, NS.w, 'pPr'))
      if (type === 'character') {
        const extra: Mark[] = []
        if (rp.highlight) extra.push({ type: 'highlight', attrs: { color: rp.highlight } })
        if (rp.vert === 'superscript') extra.push({ type: 'superscript' })
        if (rp.vert === 'subscript') extra.push({ type: 'subscript' })
        this.charStyles.set(wid, { ...clean(rp), extra })
        continue
      }
      if (type !== 'paragraph') continue
      const id = this.normId(wid)
      const basedOn = wval(child(s, NS.w, 'basedOn'))
      const next = wval(child(s, NS.w, 'next'))
      const name = wval(child(s, NS.w, 'name')) ?? wid
      if (pp.numPr) this.paraStyleNum.set(wid, pp.numPr)
      if (pp.outline && !this.headingLevel.has(wid) && !/^Heading/.test(id)) this.headingLevel.set(wid, pp.outline)
      const isNormal = id === 'Normal'
      const def: StyleDef = {
        id,
        name: isNormal ? 'Normal' : prettyName(name),
        type: 'paragraph',
        basedOn: basedOn ? this.normId(basedOn) : isNormal ? undefined : 'Normal',
        next: next ? this.normId(next) : undefined,
        run: clean(isNormal ? { ...defRun, ...rp } : rp),
        para: clean({ ...(isNormal ? defPara : {}), ...stripPara(pp) }),
        outline: this.headingLevel.get(wid),
        builtin: /^(Normal|Title|Subtitle|Heading[1-9]|Quote|Caption|NoSpacing)$/.test(id)
      }
      if (pp.contextual) (def.para as ParaProps & { contextual?: boolean }).contextual = true
      this.styles[id] = def
    }
    if (!this.styles.Normal && (Object.keys(defRun).length || Object.keys(defPara).length)) {
      this.styles.Normal = { id: 'Normal', name: 'Normal', type: 'paragraph', run: clean(defRun), para: clean(stripPara(defPara)), builtin: true }
    }
  }

  // ---------- numbering ----------
  loadNumbering() {
    const rel = [...this.rels.values()].find((r) => r.type.endsWith('/numbering'))
    const xml = rel && this.text(rel.target)
    if (!xml) return
    const root = parseXml(xml).documentElement
    const abstract = new Map<string, LevelDef[]>()
    for (const an of children(root, NS.w, 'abstractNum')) {
      const levels: LevelDef[] = []
      for (const lvl of children(an, NS.w, 'lvl')) {
        const i = num(attr(lvl, NS.w, 'ilvl')) ?? 0
        levels[i] = {
          fmt: wval(child(lvl, NS.w, 'numFmt')) ?? 'decimal',
          text: wval(child(lvl, NS.w, 'lvlText')) ?? '',
          start: num(wval(child(lvl, NS.w, 'start'))) ?? 1,
          font: attr(child(child(lvl, NS.w, 'rPr'), NS.w, 'rFonts'), NS.w, 'ascii') ?? undefined
        }
      }
      abstract.set(attr(an, NS.w, 'abstractNumId') ?? '', levels)
    }
    const nums = new Map<string, LevelDef[]>()
    for (const n of children(root, NS.w, 'num')) {
      const id = attr(n, NS.w, 'numId')
      const base = abstract.get(wval(child(n, NS.w, 'abstractNumId')) ?? '')
      if (!id || !base) continue
      const levels = base.map((l) => (l ? { ...l } : l))
      for (const o of children(n, NS.w, 'lvlOverride')) {
        const i = num(attr(o, NS.w, 'ilvl')) ?? 0
        const so = num(wval(child(o, NS.w, 'startOverride')))
        if (so != null && levels[i]) levels[i].start = so
      }
      nums.set(id, levels)
    }
    this.numbering = { get: (numId, ilvl) => nums.get(numId)?.[ilvl] ?? null }
  }

  // ---------- content ----------
  marksFor(rp: ReturnType<Reader['runProps']>): Mark[] {
    const marks: Mark[] = []
    let props = rp
    if (rp.rStyle && this.charStyles.has(rp.rStyle)) {
      const cs = this.charStyles.get(rp.rStyle)!
      if (!/hyperlink/i.test(rp.rStyle)) {
        props = { ...cs, ...rp }
        marks.push(...cs.extra)
      }
    }
    if (props.bold) marks.push({ type: 'bold' })
    if (props.italic) marks.push({ type: 'italic' })
    if (props.underline && !/hyperlink/i.test(rp.rStyle ?? '')) marks.push({ type: 'underline' })
    if (props.strike) marks.push({ type: 'strike' })
    if (props.dstrike) marks.push({ type: 'doubleStrike' })
    if (props.vert === 'superscript') marks.push({ type: 'superscript' })
    if (props.vert === 'subscript') marks.push({ type: 'subscript' })
    if (props.highlight) marks.push({ type: 'highlight', attrs: { color: props.highlight } })
    const ts: Record<string, unknown> = {}
    if (props.fontFamily) ts.fontFamily = props.fontFamily
    if (props.fontSize) ts.fontSize = `${props.fontSize}pt`
    if (props.color && !/hyperlink/i.test(rp.rStyle ?? '')) ts.color = props.color
    if (props.letterSpacing) ts.letterSpacing = props.letterSpacing
    if (props.caps) ts.caps = true
    if (props.smallCaps) ts.smallCaps = true
    if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: ts })
    // keep a stable order so adjacent runs merge
    return marks.filter((m, i, a) => a.findIndex((x) => x.type === m.type) === i)
  }

  dataUrlForRel(rid: string | null): string | null {
    const rel = rid ? this.rels.get(rid) : null
    if (!rel || rel.external) return null
    const bytes = this.files[rel.target]
    if (!bytes) return null
    const ext = rel.target.split('.').pop() ?? ''
    const mime = mimeFromExt(ext)
    if (/emf|wmf|tiff/.test(mime)) return null
    return `data:${mime};base64,${toBase64(bytes)}`
  }

  drawing(dr: El): JSONContent | null {
    const holder = child(dr, NS.wp, 'inline') ?? child(dr, NS.wp, 'anchor')
    if (!holder) return null
    const blip = find(holder, NS.a, 'blip')
    const isPicture = !!find(holder, NS.pic, 'pic')
    if (!isPicture || !blip) return null
    const src = this.dataUrlForRel(attr(blip, NS.r, 'embed'))
    if (!src) return null
    const extent = child(holder, NS.wp, 'extent')
    const docPr = child(holder, NS.wp, 'docPr')
    let float: string | null = null
    if (is(holder, NS.wp, 'anchor')) {
      const square = child(holder, NS.wp, 'wrapSquare') ?? child(holder, NS.wp, 'wrapTight') ?? child(holder, NS.wp, 'wrapThrough')
      const behind = attr(holder, null, 'behindDoc') === '1'
      const align = textOf(find(child(holder, NS.wp, 'positionH'), NS.wp, 'align'))
      if (square) float = align === 'right' ? 'right' : 'left'
      else if (child(holder, NS.wp, 'wrapNone')) this.w.add('loss', behind ? 'Images behind text are shown inline' : 'Images in front of text are shown inline')
    }
    this.imageCount++
    return {
      type: 'image',
      attrs: {
        src,
        alt: attr(docPr, null, 'descr') || null,
        title: attr(docPr, null, 'title') || null,
        width: emuToPx(num(attr(extent, null, 'cx'))),
        height: emuToPx(num(attr(extent, null, 'cy'))),
        float
      }
    }
  }

  vmlImage(pict: El): JSONContent | null {
    const img = find(pict, NS.v, 'imagedata')
    const src = img && this.dataUrlForRel(attr(img, NS.r, 'id'))
    if (!src) return null
    const style = attr(find(pict, NS.v, 'shape'), null, 'style') ?? ''
    const dim = (k: string) => {
      const m = new RegExp(`${k}:([\\d.]+)(pt|px|in)`).exec(style)
      if (!m) return null
      const v = parseFloat(m[1])
      return Math.round(m[2] === 'pt' ? v * (4 / 3) : m[2] === 'in' ? v * 96 : v)
    }
    return { type: 'image', attrs: { src, width: dim('width'), height: dim('height') } }
  }

  preservedInline(el: El, label: string): JSONContent {
    return { type: 'preservedInline', attrs: { format: 'docx', label, raw: serialize(el), text: collapse(textOf(el)) } }
  }

  /** Parse paragraph children into inline nodes; returns extra page breaks split points. */
  inlines(p: El, out: JSONContent[][], linkMark: Mark | null = null, field: FieldState = { inInstr: false, instr: '', skip: false }) {
    const push = (n: JSONContent) => out[out.length - 1].push(n)
    for (const e of elements(p)) {
      if (e.namespaceURI === NS.w) {
        switch (e.localName) {
          case 'pPr':
          case 'proofErr':
          case 'bookmarkStart':
          case 'bookmarkEnd':
          case 'permStart':
          case 'permEnd':
          case 'commentRangeStart':
          case 'commentRangeEnd':
            this.commentRange(e)
            continue
          case 'r':
            this.run(e, out, linkMark, field)
            continue
          case 'hyperlink': {
            const rid = attr(e, NS.r, 'id')
            const anchor = attr(e, NS.w, 'anchor')
            const rel = rid ? this.rels.get(rid) : null
            const href = rel?.external ? rel.target : anchor ? `#${anchor}` : null
            this.inlines(e, out, href ? { type: 'link', attrs: { href } } : linkMark, field)
            continue
          }
          case 'fldSimple': {
            const kind = this.inHF ? fieldKind(attr(e, NS.w, 'instr') ?? '') : null
            if (kind) push({ type: 'field', attrs: { kind } })
            else {
              this.w.add('info', 'Fields (references, cross-references) are kept as their current text')
              this.inlines(e, out, linkMark, field)
            }
            continue
          }
          case 'ins':
          case 'moveTo':
            this.w.add('loss', 'Tracked changes were accepted on import')
            this.inlines(e, out, linkMark, field)
            continue
          case 'del':
          case 'moveFrom':
            this.w.add('loss', 'Tracked changes were accepted on import')
            continue
          case 'smartTag':
          case 'customXml':
          case 'dir':
          case 'bdo':
            this.inlines(e, out, linkMark, field)
            continue
          case 'sdt': {
            const cb = find(child(e, NS.w, 'sdtPr'), NS.w14, 'checkbox')
            if (cb) {
              const on = attr(child(cb, NS.w14, 'checked'), NS.w14, 'val')
              push({ type: 'text', text: on === '1' || on === 'true' ? '☒' : '☐', checkbox: true })
              continue
            }
            this.inlines(child(e, NS.w, 'sdtContent')!, out, linkMark, field)
            continue
          }
        }
      }
      if (is(e, NS.m, 'oMath') || is(e, NS.m, 'oMathPara')) {
        push(this.preservedInline(e, 'Equation'))
        this.w.add('loss', 'Equations are preserved but not editable yet')
        continue
      }
      if (is(e, NS.mc, 'AlternateContent')) {
        push(this.preservedInline(e, 'Embedded object'))
        this.w.add('loss', 'Shapes, text boxes and embedded objects are preserved but not editable yet')
        continue
      }
      if (e.localName !== 'sectPr') {
        push(this.preservedInline(e, e.localName))
        this.w.add('loss', `Unsupported element <${e.localName}> preserved`)
      }
    }
  }

  run(r: El, out: JSONContent[][], linkMark: Mark | null, field: FieldState) {
    const rp = this.runProps(child(r, NS.w, 'rPr'))
    const marks = this.marksFor(rp)
    if (linkMark) marks.push(linkMark)
    for (const id of this.activeComments) marks.push({ type: 'comment', attrs: { id } })
    const push = (n: JSONContent) => out[out.length - 1].push(n)
    const text = (t: string) => {
      if (!t || field.inInstr || field.skip) return
      push(marks.length ? { type: 'text', text: t, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text: t })
    }
    for (const e of elements(r)) {
      if (e.namespaceURI === NS.w) {
        switch (e.localName) {
          case 'rPr':
          case 'lastRenderedPageBreak':
          case 'commentReference':
          case 'annotationRef':
            continue
          case 't':
            text(textOf(e))
            continue
          case 'delText':
            continue
          case 'instrText':
            if (field.inInstr) field.instr += textOf(e)
            continue
          case 'tab':
          case 'ptab':
            text('\t')
            continue
          case 'noBreakHyphen':
            text('‑')
            continue
          case 'softHyphen':
            text('­')
            continue
          case 'cr':
            push({ type: 'hardBreak' })
            continue
          case 'br': {
            const type = attr(e, NS.w, 'type')
            if (type === 'page') out.push([{ type: 'pageBreak' } as JSONContent], [])
            else {
              if (type === 'column') this.w.add('loss', 'Column breaks become line breaks')
              push({ type: 'hardBreak' })
            }
            continue
          }
          case 'sym': {
            const ch = attr(e, NS.w, 'char')
            if (ch) text(decodeBullet(String.fromCharCode(parseInt(ch, 16)), attr(e, NS.w, 'font') ?? undefined))
            continue
          }
          case 'fldChar': {
            const t = attr(e, NS.w, 'fldCharType')
            if (t === 'begin') Object.assign(field, { inInstr: true, instr: '', skip: false })
            else if (t === 'separate' || (t === 'end' && field.inInstr)) {
              field.inInstr = false
              const kind = this.inHF ? fieldKind(field.instr) : null
              if (kind) {
                push({ type: 'field', attrs: { kind } })
                field.skip = t === 'separate'
              } else if (field.instr.trim()) this.w.add('info', 'Fields (references, cross-references) are kept as their current text')
            } else if (t === 'end') field.skip = false
            continue
          }
          case 'drawing': {
            const img = this.drawing(e)
            if (img) push(img)
            else {
              push(this.preservedInline(r, find(e, NS.wps, 'wsp') ? 'Shape' : find(e, NS.a, 'graphicData') ? 'Chart or diagram' : 'Drawing'))
              this.w.add('loss', 'Charts, shapes and diagrams are preserved but not editable yet')
              return
            }
            continue
          }
          case 'pict': {
            const img = this.vmlImage(e)
            if (img) push(img)
            else {
              push(this.preservedInline(r, 'Legacy drawing'))
              this.w.add('loss', 'Legacy VML drawings are preserved but not editable')
              return
            }
            continue
          }
          case 'object':
            push(this.preservedInline(r, 'Embedded object'))
            this.w.add('loss', 'Embedded OLE objects are preserved but not editable')
            return
          case 'footnoteReference':
          case 'endnoteReference': {
            const kind = e.localName === 'footnoteReference' ? 'footnote' : 'endnote'
            const content = this.notes[kind].get(attr(e, NS.w, 'id') ?? '')
            if (content) push({ type: 'footnote', attrs: { kind, content } })
            else {
              push(this.preservedInline(r, kind === 'footnote' ? 'Footnote' : 'Endnote'))
              this.w.add('loss', 'A footnote or endnote could not be read and is preserved as-is')
            }
            continue
          }
        }
      }
      if (is(e, NS.mc, 'AlternateContent')) {
        push(this.preservedInline(r, 'Embedded object'))
        this.w.add('loss', 'Shapes, text boxes and embedded objects are preserved but not editable yet')
        return
      }
    }
  }

  paragraph(p: El, listCtx: ListBuilder): JSONContent[] {
    const pPr = child(p, NS.w, 'pPr')
    const pp = this.paraProps(pPr)
    const wStyle = wval(child(pPr, NS.w, 'pStyle'))
    if (child(pPr, NS.w, 'sectPr')) this.sectionBreak(child(pPr, NS.w, 'sectPr')!)
    const runs: JSONContent[][] = [[]]
    this.inlines(p, runs)
    const level = wStyle ? this.headingLevel.get(wStyle) : pp.outline
    const styleId = wStyle ? this.normId(wStyle) : null
    const attrs: Record<string, unknown> = {}
    for (const k of ['align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indentLeft', 'indentRight', 'indentFirst', 'keepNext', 'keepLines', 'pageBreakBefore'] as const) {
      if (pp[k] != null && pp[k] !== false) attrs[k] = pp[k]
    }
    if (onOff(child(pPr, NS.w, 'bidi'))) attrs.dir = 'rtl'
    const shd = attr(child(pPr, NS.w, 'shd'), NS.w, 'fill')
    if (shd && /^[0-9a-f]{6}$/i.test(shd)) attrs.shading = `#${shd.toLowerCase()}`
    if (child(pPr, NS.w, 'pBdr')) this.w.add('loss', 'Paragraph borders are not supported yet')
    if (child(pPr, NS.w, 'tabs')) this.w.add('info', 'Custom tab stops use default positions')

    let numPr = pp.numPr === undefined ? (wStyle ? this.paraStyleNum.get(wStyle) ?? null : null) : pp.numPr
    const numDef = numPr ? this.numbering.get(numPr.numId, numPr.ilvl) : null
    // Outline numbering on headings and unnumbered levels (numFmt none) are not lists.
    if (numPr && (level || !numDef || numDef.fmt === 'none')) {
      if (level && numDef && numDef.fmt !== 'none' && numDef.text) this.w.add('loss', 'Numbered headings are shown without their numbers')
      numPr = null
    }
    const out: JSONContent[] = []
    runs.forEach((content, i) => {
      if (content.length === 1 && content[0].type === 'pageBreak') {
        listCtx.close()
        out.push(...listCtx.flush(), content[0])
        return
      }
      if (!content.length && runs.length > 1) return // empty side of a page-break split
      const merged = mergeText(content)
      const isTask = merged[0]?.checkbox === true
      for (const n of merged) delete n.checkbox
      if (isTask) {
        const checked = merged[0].text === '☒'
        merged.shift()
        if (merged[0]?.type === 'text') merged[0] = { ...merged[0], text: merged[0].text!.replace(/^[\t ]+/, '') }
        if (merged[0]?.type === 'text' && !merged[0].text) merged.shift()
        out.push(...listCtx.addTask(checked, { type: 'paragraph', content: merged.length ? merged : undefined }))
        return
      }
      const node: JSONContent =
        level && level <= 9
          ? { type: 'heading', attrs: { level, ...attrs, styleId: styleId && !/^Heading[1-9]$/.test(styleId) ? styleId : null } }
          : { type: 'paragraph', attrs: { ...attrs, styleId: styleId && styleId !== 'Normal' ? styleId : null } }
      if (merged.length) node.content = merged
      if (numPr && i === 0) {
        delete node.attrs!.indentLeft
        delete node.attrs!.indentFirst
        if (node.attrs!.styleId === 'ListParagraph') node.attrs!.styleId = null
        out.push(...listCtx.add(numPr, node))
      } else {
        listCtx.close()
        out.push(...listCtx.flush(), node)
      }
    })
    if (this.pendingSectionBreak) {
      this.pendingSectionBreak = false
      listCtx.close()
      out.push(...listCtx.flush(), { type: 'pageBreak' })
    }
    return out
  }

  table(tbl: El, depth: number): JSONContent {
    const grid = children(child(tbl, NS.w, 'tblGrid'), NS.w, 'gridCol').map((g) => Math.round((num(attr(g, NS.w, 'w')) ?? 0) / 15))
    type Cell = { node: JSONContent; col: number; span: number; vMerge: 'restart' | 'continue' | null }
    const rows: { header: boolean; cells: Cell[] }[] = []
    for (const tr of children(tbl, NS.w, 'tr')) {
      const header = !!child(child(tr, NS.w, 'trPr'), NS.w, 'tblHeader')
      const cells: Cell[] = []
      let col = num(wval(child(child(tr, NS.w, 'trPr'), NS.w, 'gridBefore'))) ?? 0
      const tcs = elements(tr).flatMap((e) => (is(e, NS.w, 'tc') ? [e] : is(e, NS.w, 'sdt') ? children(child(e, NS.w, 'sdtContent'), NS.w, 'tc') : []))
      for (const tc of tcs) {
        const tcPr = child(tc, NS.w, 'tcPr')
        const span = num(wval(child(tcPr, NS.w, 'gridSpan'))) ?? 1
        const vm = child(tcPr, NS.w, 'vMerge')
        const vMerge = vm ? (wval(vm) === 'restart' ? 'restart' : 'continue') : null
        const shd = attr(child(tcPr, NS.w, 'shd'), NS.w, 'fill')
        const valign = wval(child(tcPr, NS.w, 'vAlign'))
        const content = this.blocks(tc, depth + 1)
        const colwidth = grid.length >= col + span ? grid.slice(col, col + span) : null
        cells.push({
          col,
          span,
          vMerge,
          node: {
            type: header ? 'tableHeader' : 'tableCell',
            attrs: {
              colspan: span,
              rowspan: 1,
              colwidth: colwidth && colwidth.every((x) => x > 0) ? colwidth : null,
              background: shd && /^[0-9a-f]{6}$/i.test(shd) ? `#${shd.toLowerCase()}` : null,
              verticalAlign: valign === 'center' ? 'middle' : valign === 'bottom' ? 'bottom' : null
            },
            content: content.length ? content : [{ type: 'paragraph' }]
          }
        })
        col += span
      }
      rows.push({ header, cells })
    }
    // vertical merges → rowspan
    for (let r = 0; r < rows.length; r++) {
      for (const cell of rows[r].cells) {
        if (cell.vMerge !== 'restart') continue
        let span = 1
        for (let k = r + 1; k < rows.length; k++) {
          const below = rows[k].cells.find((c) => c.col === cell.col && c.vMerge === 'continue')
          if (!below) break
          span++
        }
        cell.node.attrs!.rowspan = span
      }
    }
    const content = rows
      .map((row) => ({ type: 'tableRow', content: row.cells.filter((c) => c.vMerge !== 'continue').map((c) => c.node) }))
      .filter((row) => row.content.length)
    if (child(child(tbl, NS.w, 'tblPr'), NS.w, 'tblpPr')) this.w.add('info', 'Floating tables are placed inline')
    return { type: 'table', content }
  }

  blocks(container: El, depth = 0): JSONContent[] {
    const out: JSONContent[] = []
    const list = new ListBuilder(this)
    for (const e of elements(container)) {
      if (is(e, NS.w, 'p')) {
        out.push(...this.paragraph(e, list))
        continue
      }
      list.close()
      out.push(...list.flush())
      if (is(e, NS.w, 'tbl')) {
        if (depth > 0) this.w.add('info', 'Nested tables are supported but edited as regular tables')
        out.push(this.table(e, depth))
      } else if (is(e, NS.w, 'sdt')) {
        const gallery = wval(find(child(e, NS.w, 'sdtPr'), NS.w, 'docPartGallery'))
        if (gallery === 'Table of Contents') out.push(...this.tocBlock(e))
        else out.push(...this.blocks(child(e, NS.w, 'sdtContent')!, depth))
      } else if (is(e, NS.w, 'customXml') || is(e, NS.w, 'ins') || is(e, NS.w, 'moveTo')) {
        out.push(...this.blocks(e, depth))
      } else if (is(e, NS.w, 'commentRangeStart') || is(e, NS.w, 'commentRangeEnd')) {
        this.commentRange(e)
      } else if (is(e, NS.w, 'sectPr') || is(e, NS.w, 'tcPr') || is(e, NS.w, 'bookmarkStart') || is(e, NS.w, 'bookmarkEnd') || is(e, NS.w, 'proofErr') || is(e, NS.w, 'del')) {
        continue
      } else {
        this.w.add('loss', `Unsupported block <${e.localName}> preserved`)
        out.push({ type: 'preservedBlock', attrs: { format: 'docx', label: e.localName === 'altChunk' ? 'Embedded document' : e.localName, raw: serialize(e), text: collapse(textOf(e)) } })
      }
    }
    list.close()
    out.push(...list.flush())
    return out
  }

  sectionBreak(sectPr: El) {
    const type = wval(child(sectPr, NS.w, 'type'))
    this.w.add('loss', 'Multiple sections are merged; section-specific page setup uses the last section')
    if (type !== 'continuous') this.pendingSectionBreak = true
  }
  pendingSectionBreak = false

  pageSetup(sectPr: El | null): PageSetup {
    const page = makePageSetup()
    if (!sectPr) return page
    const sz = child(sectPr, NS.w, 'pgSz')
    const mar = child(sectPr, NS.w, 'pgMar')
    const w = twipToPt(num(attr(sz, NS.w, 'w')))
    const h = twipToPt(num(attr(sz, NS.w, 'h')))
    if (w && h) {
      page.width = w
      page.height = h
      page.orientation = attr(sz, NS.w, 'orient') === 'landscape' || w > h ? 'landscape' : 'portrait'
      const [pw, ph] = page.orientation === 'landscape' ? [h, w] : [w, h]
      const match = Object.entries(PAGE_SIZES).find(([, s]) => Math.abs(s.width - pw) < 3 && Math.abs(s.height - ph) < 3)
      page.size = (match?.[0] as PageSetup['size']) ?? 'custom'
    }
    if (mar) {
      const m = (k: string) => twipToPt(num(attr(mar, NS.w, k)))
      page.margins = {
        top: Math.abs(m('top') ?? 72),
        bottom: Math.abs(m('bottom') ?? 72),
        left: m('left') ?? m('start') ?? 72,
        right: m('right') ?? m('end') ?? 72,
        header: m('header') ?? 36,
        footer: m('footer') ?? 36,
        gutter: m('gutter') ?? 0
      }
    }
    if (child(sectPr, NS.w, 'cols') && (num(attr(child(sectPr, NS.w, 'cols'), NS.w, 'num')) ?? 1) > 1) this.w.add('loss', 'Multi-column layout is shown as a single column')
    const pg = child(sectPr, NS.w, 'pgNumType')
    if (pg) {
      const fmt = ({ decimal: '1', lowerRoman: 'i', upperRoman: 'I', lowerLetter: 'a', upperLetter: 'A' } as Record<string, PageNumberFormat>)[attr(pg, NS.w, 'fmt') ?? 'decimal'] ?? '1'
      page.numbering = { format: fmt, start: num(attr(pg, NS.w, 'start')) ?? 1 }
    }
    return page
  }

  meta(): DocMeta {
    const xml = this.text('docProps/core.xml')
    if (!xml) return {}
    const d = parseXml(xml).documentElement
    const get = (name: string) => {
      const e = elements(d).find((x) => x.localName === name)
      return e ? textOf(e).trim() || undefined : undefined
    }
    return { title: get('title'), subject: get('subject'), author: get('creator'), keywords: get('keywords'), description: get('description'), created: get('created'), modified: get('modified') }
  }
}

/** Converts Word's flat numbered paragraphs into nested list nodes. */
class ListBuilder {
  stack: { numId: string; ilvl: number; list: JSONContent; kind: string }[] = []
  done: JSONContent[] = []
  constructor(private r: Reader) {}

  private kindFor(def: LevelDef | null): { type: 'bulletList' | 'orderedList'; attrs: Record<string, unknown> } {
    if (!def || def.fmt === 'bullet' || def.fmt === 'none') {
      const bullet = def ? decodeBullet(def.text, def.font) : '•'
      return { type: 'bulletList', attrs: { bullet: ['•', '◦', '▪'].includes(bullet) ? null : bullet } }
    }
    const typeMap: Record<string, string> = { decimal: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I', decimalZero: '1' }
    const multi = (def.text.match(/%\d/g) ?? []).length > 1
    if (!typeMap[def.fmt]) this.r.w.add('info', `List numbering format "${def.fmt}" shown as numbers`)
    return { type: 'orderedList', attrs: { type: multi ? '1.1' : typeMap[def.fmt] ?? '1', start: def.start } }
  }

  add(numPr: { numId: string; ilvl: number }, para: JSONContent): JSONContent[] {
    const { numId, ilvl } = numPr
    if (this.stack.length && this.stack[0].numId !== numId) this.close()
    while (this.stack.length && this.stack[this.stack.length - 1].ilvl > ilvl) this.stack.pop()
    const def = this.r.numbering.get(numId, ilvl)
    const kind = this.kindFor(def)
    const counters = this.r.counters.get(numId) ?? []
    this.r.counters.set(numId, counters)
    counters[ilvl] = (counters[ilvl] ?? (def?.start ?? 1) - 1) + 1
    counters.length = ilvl + 1 // deeper levels restart
    let top = this.stack[this.stack.length - 1]
    if (top && top.ilvl === ilvl && top.kind !== kind.type) {
      this.stack.pop()
      top = this.stack[this.stack.length - 1]
    }
    if (!top || top.ilvl < ilvl) {
      const list: JSONContent = { type: kind.type, attrs: { ...kind.attrs }, content: [] }
      if (kind.type === 'orderedList') list.attrs!.start = counters[ilvl]
      if (top) top.list.content![top.list.content!.length - 1].content!.push(list)
      else this.done.push(list) // a list starting at a deep level is shown at the top level
      this.stack.push({ numId, ilvl, list, kind: kind.type })
      top = this.stack[this.stack.length - 1]
    }
    top.list.content!.push({ type: 'listItem', content: [para] })
    return []
  }

  addTask(checked: boolean, para: JSONContent): JSONContent[] {
    const top = this.stack[this.stack.length - 1]
    if (top?.kind !== 'taskList') {
      this.close()
      const list: JSONContent = { type: 'taskList', content: [] }
      this.done.push(list)
      this.stack.push({ numId: '__task', ilvl: 0, list, kind: 'taskList' })
    }
    this.stack[this.stack.length - 1].list.content!.push({ type: 'taskItem', attrs: { checked }, content: [para] })
    return []
  }

  close() {
    this.stack = []
  }

  flush(): JSONContent[] {
    const d = this.done
    this.done = []
    return d
  }
}

// ---------- helpers ----------

interface FieldState {
  inInstr: boolean
  instr: string
  /** Skipping the cached result of a field we turned into a live field node. */
  skip: boolean
}

/** Map a Word field instruction to one of our live fields. */
function fieldKind(instr: string): string | null {
  const name = instr.trim().split(/\s+/)[0]?.toUpperCase()
  return ({ PAGE: 'page', NUMPAGES: 'pages', SECTIONPAGES: 'pages', DATE: 'date', TITLE: 'title', AUTHOR: 'author' } as Record<string, string>)[name] ?? null
}

function normalizePath(p: string): string {
  const out: string[] = []
  for (const s of p.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return out.join('/')
}

function clean<T extends object>(o: T): T {
  const r: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && !['numPr', 'outline', 'rStyle', 'vert', 'highlight', 'dstrike', 'contextual', 'extra'].includes(k)) r[k] = v
  return r as T
}

function stripPara(p: ParaProps & { numPr?: unknown; outline?: unknown; contextual?: unknown }): ParaProps {
  const { numPr: _n, outline: _o, contextual: _c, ...rest } = p
  return rest
}

function prettyName(n: string): string {
  return n.replace(/^[a-z]/, (c) => c.toUpperCase())
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 400)

/** Merge adjacent text nodes with identical marks. */
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev && prev.type === 'text' && n.type === 'text' && !prev.checkbox && !n.checkbox && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) prev.text += n.text ?? ''
    else out.push({ ...n })
  }
  return out
}

export function importDocx(data: Uint8Array): ImportResult {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('This file is not a valid DOCX package (it may be damaged or password-protected).')
  }
  const rootRels = files['_rels/.rels'] ? parseXml(strFromU8(files['_rels/.rels'])).documentElement : null
  const officeRel = elements(rootRels).find((r) => (attr(r, null, 'Type') ?? '').endsWith('/officeDocument'))
  const docPath = (attr(officeRel ?? null, null, 'Target') ?? 'word/document.xml').replace(/^\//, '')
  if (!files[docPath]) throw new Error('The DOCX package has no main document part.')

  const r = new Reader(files, docPath)
  r.loadRels()
  r.loadTheme()
  r.loadStyles()
  r.loadNumbering()
  r.loadNotes()
  r.loadComments()

  const doc = parseXml(strFromU8(files[docPath]))
  const body = find(doc.documentElement, NS.w, 'body')
  if (!body) throw new Error('The document body is missing.')
  const content = r.blocks(body)

  const finalSect = child(body, NS.w, 'sectPr')
  const page = r.pageSetup(finalSect)
  const settingsRel = [...r.rels.values()].find((x) => x.type.endsWith('/settings'))
  const settingsXml = settingsRel && r.text(settingsRel.target)
  const evenAndOdd = !!settingsXml && /<w:evenAndOddHeaders(?![^>]*w:val="(0|false)")/.test(settingsXml)
  const hfResult = r.headersFooters(finalSect, evenAndOdd)
  // Header/footer references, titlePg and pgNumType are regenerated from the model on save.
  const extra = finalSect
    ? elements(finalSect)
        .filter((e) => ['docGrid', 'lnNumType', 'pgBorders', 'vAlign', 'textDirection', 'formProt', 'noEndnote', 'bidi', 'rtlGutter', 'printerSettings'].includes(e.localName))
        .map(serialize)
        .join('')
    : ''
  if (findAll(doc.documentElement, NS.w, 'pgBorders').length) r.w.add('info', 'Page borders are preserved but not shown')

  // Overrides from [Content_Types].xml so carried parts keep their content type.
  const overrides: Record<string, string> = {}
  const ct = files['[Content_Types].xml']
  if (ct) for (const o of children(parseXml(strFromU8(ct)).documentElement, NS.ct, 'Override')) overrides[(attr(o, null, 'PartName') ?? '').replace(/^\//, '')] = attr(o, null, 'ContentType') ?? ''

  const carry: DocxCarry = { parts: files, rels: [...r.rels.values()], sectPrExtra: extra, overrides, converted: [...(hfResult?.parts ?? []), ...r.noteParts, ...r.commentParts] }
  return {
    doc: { type: 'doc', attrs: { page, styles: r.styles, meta: r.meta(), hf: hfResult?.hf ?? null, comments: Object.keys(r.comments).length ? r.comments : null }, content: content.length ? content : [{ type: 'paragraph' }] },
    warnings: r.w.list(),
    carry
  }
}

export { child, children, find, wval }
