import type { WrappedPdfiumModule } from '@embedpdf/pdfium'

// PDF engine on PDFium (WASM). Pure: no DOM, so it runs in a worker or in Node tests.
// Coordinates are PDF user space (points, origin bottom-left) unless noted.

export interface PageInfo {
  /** Displayed size in points (after /Rotate). */
  width: number
  height: number
  /** 0, 90, 180 or 270 (clockwise). Text boxes are in unrotated page space. */
  rotation: number
}

export interface TextChar {
  ch: string
  /** left, top, right, bottom in PDF points */
  box: [number, number, number, number]
}

export interface TextRun {
  text: string
  /** Bounds in PDF points: left, top, right, bottom */
  box: [number, number, number, number]
  /** Character range [start, end) on the page (for editing / selection). */
  start: number
  end: number
  fontSize: number
}

export type AnnotKind = 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'note' | 'freetext' | 'ink' | 'square' | 'other'

export interface AnnotInfo {
  index: number
  kind: AnnotKind
  subtype: number
  rect: [number, number, number, number]
  contents: string
  author: string
}

export interface FieldInfo {
  annotIndex: number
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'button' | 'signature' | 'unknown'
  value: string
  checked: boolean
  rect: [number, number, number, number]
}

export interface EditResult {
  ok: boolean
  /** 'original-font' when the existing font could encode the new text; 'substitute-font' otherwise. */
  method: 'original-font' | 'substitute-font' | 'none'
  fontName: string
}

const SUBTYPE: Record<number, AnnotKind> = { 1: 'note', 3: 'freetext', 5: 'square', 9: 'highlight', 10: 'underline', 11: 'squiggly', 12: 'strikeout', 15: 'ink' }
const SUBTYPE_ID: Record<Exclude<AnnotKind, 'other'>, number> = { note: 1, freetext: 3, square: 5, highlight: 9, underline: 10, squiggly: 11, strikeout: 12, ink: 15 }
const FIELD_TYPES: Record<number, FieldInfo['type']> = { 1: 'button', 2: 'checkbox', 3: 'radio', 4: 'combo', 5: 'list', 6: 'text', 7: 'signature' }

export class PdfiumError extends Error {}

export class PdfEngine {
  constructor(public m: WrappedPdfiumModule) {
    m.PDFiumExt_Init()
  }

  // ---------- memory helpers ----------
  get heap(): Uint8Array {
    return (this.m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8
  }
  malloc(n: number): number {
    const p = this.m.pdfium.wasmExports.malloc(n)
    if (!p) throw new PdfiumError('Out of memory')
    return p
  }
  free(p: number) {
    if (p) this.m.pdfium.wasmExports.free(p)
  }
  /** Run `fn` with a scratch buffer of `n` bytes. */
  withBuf<T>(n: number, fn: (p: number) => T): T {
    const p = this.malloc(n)
    try {
      return fn(p)
    } finally {
      this.free(p)
    }
  }
  floats(p: number, n: number): number[] {
    return Array.from({ length: n }, (_, i) => this.m.pdfium.getValue(p + i * 4, 'float') as number)
  }
  setFloats(p: number, values: number[]) {
    values.forEach((v, i) => this.m.pdfium.setValue(p + i * 4, v, 'float'))
  }
  /** Allocate a NUL-terminated UTF-16LE string (PDFium FPDF_WIDESTRING). Caller frees. */
  wide(s: string): number {
    const bytes = (s.length + 1) * 2
    const p = this.malloc(bytes)
    this.m.pdfium.stringToUTF16(s, p, bytes)
    return p
  }
  /** Read a UTF-16 string from a "call twice" API: first call returns needed bytes. */
  readWide(call: (buf: number, len: number) => number): string {
    const len = call(0, 0)
    if (len <= 2) return ''
    return this.withBuf(len, (p) => {
      call(p, len)
      return this.m.pdfium.UTF16ToString(p)
    })
  }
  readUtf8(call: (buf: number, len: number) => number): string {
    const len = call(0, 0)
    if (len <= 1) return ''
    return this.withBuf(len, (p) => {
      call(p, len)
      return this.m.pdfium.UTF8ToString(p)
    })
  }

  open(bytes: Uint8Array, password = ''): PdfDocument {
    const p = this.malloc(bytes.length)
    this.heap.set(bytes, p)
    const doc = this.m.FPDF_LoadMemDocument(p, bytes.length, password)
    if (!doc) {
      this.free(p)
      const err = this.m.FPDF_GetLastError()
      throw new PdfiumError(err === 4 ? 'This PDF is password-protected.' : err === 3 ? 'This file is not a valid PDF (it may be damaged).' : `This PDF could not be opened (error ${err}).`)
    }
    return new PdfDocument(this, doc, p)
  }

  create(): PdfDocument {
    return new PdfDocument(this, this.m.FPDF_CreateNewDocument(), 0)
  }
}

export class PdfDocument {
  private form = 0
  private formInfo = 0
  constructor(
    public e: PdfEngine,
    public ptr: number,
    private dataPtr: number
  ) {
    this.form = 0
  }

  get m() {
    return this.e.m
  }

  close() {
    if (this.form) {
      this.m.PDFiumExt_ExitFormFillEnvironment(this.form)
      this.m.PDFiumExt_CloseFormFillInfo(this.formInfo)
      this.form = 0
    }
    this.m.FPDF_CloseDocument(this.ptr)
    this.e.free(this.dataPtr)
  }

  /** Form-fill environment (created on first use, needed to draw and edit form fields). */
  formHandle(): number {
    if (!this.form) {
      this.formInfo = this.m.PDFiumExt_OpenFormFillInfo()
      this.form = this.m.PDFiumExt_InitFormFillEnvironment(this.ptr, this.formInfo)
    }
    return this.form
  }

  pageCount(): number {
    return this.m.FPDF_GetPageCount(this.ptr)
  }

  pageInfo(i: number): PageInfo {
    const size = this.e.withBuf(8, (p) => (this.m.FPDF_GetPageSizeByIndexF(this.ptr, i, p) ? this.e.floats(p, 2) : [612, 792]))
    return this.withPage(i, (page) => ({ width: size[0], height: size[1], rotation: this.m.FPDFPage_GetRotation(page) * 90 }))
  }

  /** Load a page, run `fn`, close it. With `forms`, the form environment is attached. */
  withPage<T>(i: number, fn: (page: number) => T, forms = false): T {
    const page = this.m.FPDF_LoadPage(this.ptr, i)
    if (!page) throw new PdfiumError(`Page ${i + 1} could not be loaded`)
    if (forms) this.m.FORM_OnAfterLoadPage(page, this.formHandle())
    try {
      return fn(page)
    } finally {
      this.m.FPDF_ClosePage(page)
    }
  }

  withTextPage<T>(page: number, fn: (tp: number) => T): T {
    const tp = this.m.FPDFText_LoadPage(page)
    try {
      return fn(tp)
    } finally {
      this.m.FPDFText_ClosePage(tp)
    }
  }

  // ---------- rendering ----------
  /** Render a page to RGBA pixels (including annotations and form fields). `scale` = pixels per point. */
  render(i: number, scale: number): { width: number; height: number; data: Uint8ClampedArray } {
    // PDFium reports the size of the displayed (already rotated) page.
    const info = this.pageInfo(i)
    const w = Math.max(1, Math.round(info.width * scale))
    const h = Math.max(1, Math.round(info.height * scale))
    return this.withPage(
      i,
      (page) => {
        const bmp = this.m.FPDFBitmap_CreateEx(w, h, 4, 0, 0)
        try {
          this.m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff)
          const FLAGS = 0x01 | 0x10 // FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER (RGBA)
          this.m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, FLAGS)
          if (this.form) this.m.FPDF_FFLDraw(this.form, bmp, page, 0, 0, w, h, 0, FLAGS)
          const buf = this.m.FPDFBitmap_GetBuffer(bmp)
          const stride = this.m.FPDFBitmap_GetStride(bmp)
          const out = new Uint8ClampedArray(w * h * 4)
          for (let y = 0; y < h; y++) out.set(this.e.heap.subarray(buf + y * stride, buf + y * stride + w * 4), y * w * 4)
          return { width: w, height: h, data: out }
        } finally {
          this.m.FPDFBitmap_Destroy(bmp)
        }
      },
      !!this.form
    )
  }

  // ---------- text ----------
  chars(i: number): TextChar[] {
    return this.withPage(i, (page) =>
      this.withTextPage(page, (tp) => {
        const n = this.m.FPDFText_CountChars(tp)
        return this.e.withBuf(32, (b) => {
          const out: TextChar[] = []
          for (let k = 0; k < n; k++) {
            const code = this.m.FPDFText_GetUnicode(tp, k)
            this.m.FPDFText_GetCharBox(tp, k, b, b + 8, b + 16, b + 24)
            const [l, r, bot, t] = [0, 8, 16, 24].map((o) => this.m.pdfium.getValue(b + o, 'double') as number)
            out.push({ ch: String.fromCodePoint(code || 32), box: [l, t, r, bot] })
          }
          return out
        })
      })
    )
  }

  text(i: number): string {
    return this.chars(i)
      .map((c) => c.ch)
      .join('')
  }

  /** Text grouped into runs (one per text object segment on a line) for selection layers and editing. */
  runs(i: number): TextRun[] {
    return this.withPage(i, (page) =>
      this.withTextPage(page, (tp) => {
        const n = this.m.FPDFText_CountChars(tp)
        const out: TextRun[] = []
        let cur: TextRun | null = null
        let curObj = 0
        this.e.withBuf(32, (b) => {
          for (let k = 0; k < n; k++) {
            const code = this.m.FPDFText_GetUnicode(tp, k)
            const obj = this.m.FPDFText_GetTextObject(tp, k)
            this.m.FPDFText_GetCharBox(tp, k, b, b + 8, b + 16, b + 24)
            const [l, r, bot, t] = [0, 8, 16, 24].map((o) => this.m.pdfium.getValue(b + o, 'double') as number)
            const ch = code === 13 || code === 10 ? '' : String.fromCodePoint(code || 32)
            const generated = code === 13 || code === 10 || (l === 0 && r === 0 && t === 0 && bot === 0)
            if (generated) {
              cur = null
              continue
            }
            const sameLine = cur && Math.abs(cur.box[3] - bot) < (t - bot) * 0.6
            if (!cur || obj !== curObj || !sameLine) {
              cur = { text: '', box: [l, t, r, bot], start: k, end: k, fontSize: this.m.FPDFText_GetFontSize(tp, k) }
              out.push(cur)
              curObj = obj
            }
            cur.text += ch
            cur.end = k + 1
            cur.box = [Math.min(cur.box[0], l), Math.max(cur.box[1], t), Math.max(cur.box[2], r), Math.min(cur.box[3], bot)]
          }
        })
        return out.filter((r) => r.text.trim())
      })
    )
  }

  /** Runs merged into visual lines (same baseline, close together) — what a reader thinks of as "a line of text". */
  lines(i: number): TextRun[] {
    const out: TextRun[] = []
    for (const r of this.runs(i)) {
      const prev = out[out.length - 1]
      // Tolerances scale with the font size (glyph boxes of punctuation are tiny).
      const fs = Math.max(prev?.fontSize ?? 0, r.fontSize, 4)
      if (prev && Math.abs(prev.box[3] - r.box[3]) < fs * 0.4 && r.box[0] - prev.box[2] < fs * 1.2 && r.box[0] >= prev.box[2] - fs) {
        const gap = r.box[0] - prev.box[2]
        prev.text += (gap > r.fontSize * 0.2 && !/\s$/.test(prev.text) && !/^\s/.test(r.text) ? ' ' : '') + r.text
        prev.end = r.end
        prev.box = [Math.min(prev.box[0], r.box[0]), Math.max(prev.box[1], r.box[1]), Math.max(prev.box[2], r.box[2]), Math.min(prev.box[3], r.box[3])]
      } else out.push({ ...r })
    }
    return out
  }

  /** Case-insensitive search; returns per-page hit boxes. */
  search(query: string): { page: number; boxes: [number, number, number, number][] }[] {
    const q = query.toLowerCase()
    const hits: { page: number; boxes: [number, number, number, number][] }[] = []
    if (!q) return hits
    for (let p = 0; p < this.pageCount(); p++) {
      const chars = this.chars(p)
      const text = chars.map((c) => c.ch.toLowerCase()).join('')
      for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + 1)) {
        const span = chars.slice(at, at + q.length)
        hits.push({ page: p, boxes: [[Math.min(...span.map((c) => c.box[0])), Math.max(...span.map((c) => c.box[1])), Math.max(...span.map((c) => c.box[2])), Math.min(...span.map((c) => c.box[3]))]] })
      }
    }
    return hits
  }

  // ---------- editing existing text ----------
  private charsets = new Map<string, Set<string>>()

  /** Characters drawn anywhere in the document with the font of this base name. */
  fontCharset(fontName: string): Set<string> {
    let set = this.charsets.get(fontName)
    if (set) return set
    set = new Set<string>()
    for (let p = 0; p < this.pageCount(); p++)
      this.withPage(p, (page) =>
        this.withTextPage(page, (tp) => {
          const n = this.m.FPDFText_CountChars(tp)
          this.e.withBuf(260, (buf) => {
            for (let k = 0; k < n; k++) {
              const len = this.m.FPDFText_GetFontInfo(tp, k, buf, 256, 0)
              if (len > 0 && this.m.pdfium.UTF8ToString(buf).replace(/^[A-Z]{6}\+/, '') === fontName) set!.add(String.fromCodePoint(this.m.FPDFText_GetUnicode(tp, k)))
            }
          })
        })
      )
    this.charsets.set(fontName, set)
    return set
  }
  /**
   * Replace the text of the text object containing character `charIndex` on page `i`.
   * The content stream is rewritten (no overlay). The original font is kept when it can
   * encode the new text (verified by re-reading the page); otherwise the object is
   * recreated with a standard font of the same family (serif / sans / mono).
   */
  editText(i: number, charIndex: number, newText: string, endIndex = charIndex + 1): EditResult {
    return this.withPage(i, (page) => {
      // Every text object touched by the character range; the first one becomes the template.
      const objs = this.withTextPage(page, (tp) => {
        const list: number[] = []
        for (let k = charIndex; k < endIndex; k++) {
          const o = this.m.FPDFText_GetTextObject(tp, k)
          if (o && !list.includes(o)) list.push(o)
        }
        return list
      })
      const obj = objs[0]
      if (!obj) return { ok: false, method: 'none', fontName: '' }
      const others = objs.slice(1)
      const font = this.m.FPDFTextObj_GetFont(obj)
      const fontName = this.e.readUtf8((b, l) => this.m.FPDFFont_GetBaseFontName(font, b, l))
      const before = this.withTextPage(page, (tp) => this.e.readWide((b, l) => this.m.FPDFTextObj_GetText(obj, tp, b, l)))
      const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
      // Embedded fonts are almost always subsets: they can only draw characters the document
      // already uses with them. Anything else must go to a substitute font.
      const embedded = this.m.FPDFFont_GetIsEmbedded(font)
      const covered = !embedded || [...newText].every((c) => /\s/.test(c) || this.fontCharset(fontName).has(c))
      // 1. Try the original font: the template object takes the whole new text, the rest are removed.
      const w = covered ? this.e.wide(newText) : 0
      const set = covered && this.m.FPDFText_SetText(obj, w)
      if (w) this.e.free(w)
      if (set) {
        for (const o of others) this.m.FPDFPage_RemoveObject(page, o)
        this.m.FPDFPage_GenerateContent(page)
        const after = this.withTextPage(page, (tp) => this.e.readWide((b, l) => this.m.FPDFTextObj_GetText(obj, tp, b, l)))
        if (norm(after) === norm(newText)) return { ok: true, method: 'original-font', fontName }
        others.length = 0 // already removed
      }
      // 2. Recreate with a standard font at the same position, size and color.
      const flags = this.m.FPDFFont_GetFlags(font)
      const mono = (flags & 1) !== 0 || /mono|courier/i.test(fontName)
      const serif = !mono && ((flags & 2) !== 0 || /times|serif|roman|cambria|caladea|georgia|garamond/i.test(fontName))
      const bold = /bold|black|heavy|semibold/i.test(fontName)
      const italic = /italic|oblique/i.test(fontName)
      const std = mono ? `Courier${bold || italic ? '-' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '') : ''}` : serif ? `Times-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Roman'}` : `Helvetica${bold || italic ? '-' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '') : ''}`
      const size = this.e.withBuf(4, (p) => (this.m.FPDFTextObj_GetFontSize(obj, p) ? this.e.floats(p, 1)[0] : 12))
      const matrix = this.e.withBuf(24, (p) => (this.m.FPDFPageObj_GetMatrix(obj, p) ? this.e.floats(p, 6) : null))
      const color = this.e.withBuf(16, (p) => (this.m.FPDFPageObj_GetFillColor(obj, p, p + 4, p + 8, p + 12) ? [0, 4, 8, 12].map((o) => this.m.pdfium.getValue(p + o, 'i32') as number) : [0, 0, 0, 255]))
      const stdFont = this.m.FPDFText_LoadStandardFont(this.ptr, std)
      const nobj = this.m.FPDFPageObj_CreateTextObj(this.ptr, stdFont, size)
      if (!nobj) {
        // restore original text
        const r = this.e.wide(before)
        this.m.FPDFText_SetText(obj, r)
        this.e.free(r)
        return { ok: false, method: 'none', fontName }
      }
      const nw = this.e.wide(newText)
      this.m.FPDFText_SetText(nobj, nw)
      this.e.free(nw)
      if (matrix) this.e.withBuf(24, (p) => (this.e.setFloats(p, matrix), this.m.FPDFPageObj_SetMatrix(nobj, p)))
      this.m.FPDFPageObj_SetFillColor(nobj, color[0], color[1], color[2], color[3])
      this.m.FPDFPage_RemoveObject(page, obj)
      for (const o of others) this.m.FPDFPage_RemoveObject(page, o)
      this.m.FPDFPage_InsertObject(page, nobj)
      this.m.FPDFPage_GenerateContent(page)
      return { ok: true, method: 'substitute-font', fontName: std }
    })
  }

  /** Add new text as page content (one text object per line) with a standard font. Baseline of the first line at (x, y). */
  addText(i: number, x: number, y: number, text: string, size = 12, color: [number, number, number, number] = [0, 0, 0, 255], fontName = 'Helvetica'): boolean {
    return this.withPage(i, (page) => {
      const font = this.m.FPDFText_LoadStandardFont(this.ptr, fontName)
      text.split('\n').forEach((line, k) => {
        const obj = this.m.FPDFPageObj_CreateTextObj(this.ptr, font, size)
        const w = this.e.wide(line)
        this.m.FPDFText_SetText(obj, w)
        this.e.free(w)
        this.e.withBuf(24, (p) => (this.e.setFloats(p, [1, 0, 0, 1, x, y - k * size * 1.25]), this.m.FPDFPageObj_SetMatrix(obj, p)))
        this.m.FPDFPageObj_SetFillColor(obj, color[0], color[1], color[2], color[3])
        this.m.FPDFPage_InsertObject(page, obj)
      })
      return this.m.FPDFPage_GenerateContent(page)
    })
  }

  // ---------- redaction ----------
  /**
   * Permanently remove all content (text, images, vector graphics) inside rectangles and
   * paint them black. Uses redact annotations applied immediately, so nothing remains
   * hidden underneath — the removed content is gone from the file.
   */
  redact(i: number, rects: [number, number, number, number][]): boolean {
    return this.withPage(i, (page) => {
      let ok = true
      for (const r of rects) {
        const a = this.m.EPDFPage_CreateAnnot(page, 28) // Redact
        if (!a) {
          ok = false
          continue
        }
        const [l, t, rr, b] = r
        this.e.withBuf(16, (p) => (this.e.setFloats(p, r), this.m.FPDFAnnot_SetRect(a, p)))
        this.e.withBuf(32, (p) => (this.e.setFloats(p, [l, t, rr, t, l, b, rr, b]), this.m.FPDFAnnot_AppendAttachmentPoints(a, p)))
        ok = this.m.EPDFAnnot_ApplyRedaction(page, a) && ok
        this.m.FPDFPage_CloseAnnot(a)
        // Black box as real page content.
        const box = this.m.FPDFPageObj_CreateNewRect(l, b, rr - l, t - b)
        this.m.FPDFPageObj_SetFillColor(box, 0, 0, 0, 255)
        this.m.FPDFPath_SetDrawMode(box, 1, false)
        this.m.FPDFPage_InsertObject(page, box)
      }
      return this.m.FPDFPage_GenerateContent(page) && ok
    })
  }

  // ---------- annotations ----------
  annotations(i: number): AnnotInfo[] {
    return this.withPage(i, (page) => {
      const n = this.m.FPDFPage_GetAnnotCount(page)
      const out: AnnotInfo[] = []
      for (let k = 0; k < n; k++) {
        const a = this.m.FPDFPage_GetAnnot(page, k)
        try {
          const subtype = this.m.FPDFAnnot_GetSubtype(a)
          if (subtype === 20 || subtype === 2) continue // widgets (forms) and links are not markup
          const rect = this.e.withBuf(16, (p) => (this.m.FPDFAnnot_GetRect(a, p) ? (this.e.floats(p, 4) as AnnotInfo['rect']) : ([0, 0, 0, 0] as AnnotInfo['rect'])))
          const str = (key: string) => this.e.readWide((b, l) => this.m.FPDFAnnot_GetStringValue(a, key, b, l))
          out.push({ index: k, kind: SUBTYPE[subtype] ?? 'other', subtype, rect, contents: str('Contents'), author: str('T') })
        } finally {
          this.m.FPDFPage_CloseAnnot(a)
        }
      }
      return out
    })
  }

  /**
   * Add a markup annotation. For text markup, `quads` are boxes (left, top, right, bottom)
   * covering the text; for ink, `ink` is a list of strokes.
   */
  addAnnotation(
    i: number,
    kind: Exclude<AnnotKind, 'other'>,
    opts: { rect: [number, number, number, number]; quads?: [number, number, number, number][]; ink?: [number, number][][]; color?: [number, number, number, number]; contents?: string; author?: string }
  ): boolean {
    return this.withPage(i, (page) => {
      const a = this.m.EPDFPage_CreateAnnot(page, SUBTYPE_ID[kind])
      if (!a) return false
      try {
        this.e.withBuf(16, (p) => (this.e.setFloats(p, opts.rect), this.m.FPDFAnnot_SetRect(a, p)))
        const c = opts.color ?? (kind === 'highlight' ? [255, 221, 0, 255] : kind === 'note' ? [255, 200, 0, 255] : [220, 30, 30, 255])
        this.m.FPDFAnnot_SetColor(a, 0, c[0], c[1], c[2], c[3])
        for (const q of opts.quads ?? []) {
          const [l, t, r, b] = q
          this.e.withBuf(32, (p) => (this.e.setFloats(p, [l, t, r, t, l, b, r, b]), this.m.FPDFAnnot_AppendAttachmentPoints(a, p)))
        }
        for (const stroke of opts.ink ?? [])
          this.e.withBuf(stroke.length * 8, (p) => {
            this.e.setFloats(p, stroke.flat())
            this.m.FPDFAnnot_AddInkStroke(a, p, stroke.length)
          })
        const setStr = (key: string, v: string | undefined) => {
          if (!v) return
          const w = this.e.wide(v)
          this.m.FPDFAnnot_SetStringValue(a, key, w)
          this.e.free(w)
        }
        setStr('Contents', opts.contents)
        setStr('T', opts.author)
        setStr('M', `D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`)
        this.m.FPDFAnnot_SetFlags(a, 4) // print
        this.m.EPDFAnnot_GenerateAppearance(a)
        return true
      } finally {
        this.m.FPDFPage_CloseAnnot(a)
      }
    })
  }

  removeAnnotation(i: number, index: number): boolean {
    return this.withPage(i, (page) => this.m.FPDFPage_RemoveAnnot(page, index))
  }

  // ---------- forms ----------
  fields(i: number): FieldInfo[] {
    const form = this.formHandle()
    return this.withPage(
      i,
      (page) => {
        const out: FieldInfo[] = []
        const n = this.m.FPDFPage_GetAnnotCount(page)
        for (let k = 0; k < n; k++) {
          const a = this.m.FPDFPage_GetAnnot(page, k)
          try {
            if (this.m.FPDFAnnot_GetSubtype(a) !== 20) continue
            const rect = this.e.withBuf(16, (p) => (this.m.FPDFAnnot_GetRect(a, p) ? (this.e.floats(p, 4) as FieldInfo['rect']) : ([0, 0, 0, 0] as FieldInfo['rect'])))
            out.push({
              annotIndex: k,
              name: this.e.readWide((b, l) => this.m.FPDFAnnot_GetFormFieldName(form, a, b, l)),
              type: FIELD_TYPES[this.m.FPDFAnnot_GetFormFieldType(form, a)] ?? 'unknown',
              value: this.e.readWide((b, l) => this.m.FPDFAnnot_GetFormFieldValue(form, a, b, l)),
              checked: this.m.FPDFAnnot_IsChecked(form, a),
              rect
            })
          } finally {
            this.m.FPDFPage_CloseAnnot(a)
          }
        }
        return out
      },
      true
    )
  }

  setFieldValue(i: number, annotIndex: number, value: string): boolean {
    const form = this.formHandle()
    return this.withPage(
      i,
      (page) => {
        const a = this.m.FPDFPage_GetAnnot(page, annotIndex)
        try {
          const w = this.e.wide(value)
          const ok = this.m.EPDFAnnot_SetFormFieldValue(form, a, w)
          this.e.free(w)
          this.m.EPDFAnnot_GenerateFormFieldAP(a)
          return ok
        } finally {
          this.m.FPDFPage_CloseAnnot(a)
        }
      },
      true
    )
  }

  /** Create a fillable form field (widget) at rect. */
  createField(i: number, type: 'text' | 'checkbox', name: string, rect: [number, number, number, number]): boolean {
    const form = this.formHandle()
    return this.withPage(
      i,
      (page) => {
        const namePtr = this.e.wide(name)
        const a = this.m.EPDFPage_CreateFormField(page, form, type === 'text' ? 6 : 2, namePtr)
        this.e.free(namePtr)
        if (!a) return false
        try {
          this.e.withBuf(16, (p) => (this.e.setFloats(p, rect), this.m.FPDFAnnot_SetRect(a, p)))
          this.m.FPDFAnnot_SetFlags(a, 4)
          this.m.EPDFAnnot_GenerateFormFieldAP(a)
          return true
        } finally {
          this.m.FPDFPage_CloseAnnot(a)
        }
      },
      true
    )
  }

  // ---------- images ----------
  /** Place a PNG on the page (e.g. a signature) at rect (points). */
  addPng(i: number, png: Uint8Array, rect: [number, number, number, number]): boolean {
    return this.withPage(i, (page) => {
      const obj = this.m.FPDFPageObj_NewImageObj(this.ptr)
      const ok = this.e.withBuf(png.length, (p) => {
        this.e.heap.set(png, p)
        return this.m.EPDFImageObj_SetPng(page, 0, obj, p, png.length)
      })
      if (!ok) return false
      const [l, t, r, b] = rect
      this.m.FPDFImageObj_SetMatrix(obj, r - l, 0, 0, t - b, l, b)
      this.m.FPDFPage_InsertObject(page, obj)
      return this.m.FPDFPage_GenerateContent(page)
    })
  }

  // ---------- pages ----------
  rotate(i: number, degrees: number) {
    this.withPage(i, (page) => this.m.FPDFPage_SetRotation(page, (((this.m.FPDFPage_GetRotation(page) + Math.round(degrees / 90)) % 4) + 4) % 4))
  }

  deletePage(i: number) {
    this.m.FPDFPage_Delete(this.ptr, i)
  }

  insertBlank(at: number, width = 612, height = 792) {
    const page = this.m.FPDFPage_New(this.ptr, at, width, height)
    if (page) this.m.FPDF_ClosePage(page)
  }

  /** Move pages (by current index) so they start at `dest`. */
  movePages(indices: number[], dest: number): boolean {
    return this.e.withBuf(indices.length * 4, (p) => {
      indices.forEach((v, k) => this.m.pdfium.setValue(p + k * 4, v, 'i32'))
      return this.m.FPDF_MovePages(this.ptr, p, indices.length, dest)
    })
  }

  /** Copy pages from another document into this one at `at` (all pages when `indices` is omitted). */
  importPages(src: PdfDocument, at: number, indices?: number[]): boolean {
    const list = indices ?? Array.from({ length: src.pageCount() }, (_, k) => k)
    return this.e.withBuf(list.length * 4, (p) => {
      list.forEach((v, k) => this.m.pdfium.setValue(p + k * 4, v, 'i32'))
      return this.m.FPDF_ImportPagesByIndex(this.ptr, src.ptr, p, list.length, at)
    })
  }

  /** New document containing the given pages (extract / split). */
  extract(indices: number[]): Uint8Array {
    const out = this.e.create()
    try {
      out.importPages(this, 0, indices)
      return out.save()
    } finally {
      out.close()
    }
  }

  crop(i: number, box: [number, number, number, number]) {
    const [l, t, r, b] = box
    this.withPage(i, (page) => this.m.FPDFPage_SetCropBox(page, l, b, r, t))
  }

  // ---------- metadata ----------
  getMeta(key: 'Title' | 'Author' | 'Subject' | 'Keywords' | 'Creator' | 'Producer'): string {
    return this.e.readWide((b, l) => this.m.FPDF_GetMetaText(this.ptr, key, b, l))
  }

  setMeta(key: 'Title' | 'Author' | 'Subject' | 'Keywords', value: string): boolean {
    const w = this.e.wide(value)
    try {
      return this.m.EPDF_SetMetaText(this.ptr, key, w)
    } finally {
      this.e.free(w)
    }
  }

  // ---------- save ----------
  save(): Uint8Array {
    const writer = this.m.PDFiumExt_OpenFileWriter()
    try {
      if (!this.m.PDFiumExt_SaveAsCopy(this.ptr, writer)) throw new PdfiumError('The PDF could not be saved')
      const size = this.m.PDFiumExt_GetFileWriterSize(writer)
      return this.e.withBuf(size, (p) => {
        this.m.PDFiumExt_GetFileWriterData(writer, p, size)
        return this.e.heap.slice(p, p + size)
      })
    } finally {
      this.m.PDFiumExt_CloseFileWriter(writer)
    }
  }
}
