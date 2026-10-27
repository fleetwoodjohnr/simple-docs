// Document-level model shared by the editor, layout engine and format adapters.
// All lengths are in points (1pt = 1/72in) unless noted.

export const PT_TO_PX = 96 / 72
export const ptToPx = (pt: number) => pt * PT_TO_PX
export const pxToPt = (px: number) => px / PT_TO_PX

export type PageSizeId = 'letter' | 'a4' | 'legal' | 'a3' | 'a5' | 'custom'
export type Orientation = 'portrait' | 'landscape'

export const PAGE_SIZES: Record<Exclude<PageSizeId, 'custom'>, { label: string; width: number; height: number }> = {
  letter: { label: 'Letter', width: 612, height: 792 },
  a4: { label: 'A4', width: 595.3, height: 841.9 },
  legal: { label: 'Legal', width: 612, height: 1008 },
  a3: { label: 'A3', width: 841.9, height: 1190.6 },
  a5: { label: 'A5', width: 419.5, height: 595.3 }
}

export interface PageMargins {
  top: number
  right: number
  bottom: number
  left: number
  header: number
  footer: number
  gutter: number
}

export const MARGIN_PRESETS: Record<'normal' | 'narrow' | 'moderate' | 'wide', { label: string; margins: Omit<PageMargins, 'header' | 'footer' | 'gutter'> }> = {
  normal: { label: 'Normal', margins: { top: 72, right: 72, bottom: 72, left: 72 } },
  narrow: { label: 'Narrow', margins: { top: 36, right: 36, bottom: 36, left: 36 } },
  moderate: { label: 'Moderate', margins: { top: 72, right: 54, bottom: 72, left: 54 } },
  wide: { label: 'Wide', margins: { top: 72, right: 144, bottom: 72, left: 144 } }
}

export type PageNumberFormat = '1' | 'i' | 'I' | 'a' | 'A'

export interface PageSetup {
  size: PageSizeId
  /** Width/height as displayed (already swapped for landscape). */
  width: number
  height: number
  orientation: Orientation
  margins: PageMargins
  background: string | null
  /** Page number format and starting value (defaults: '1', 1). */
  numbering?: { format: PageNumberFormat; start: number }
}

export function makePageSetup(size: Exclude<PageSizeId, 'custom'> = 'letter', margins: keyof typeof MARGIN_PRESETS = 'normal'): PageSetup {
  const s = PAGE_SIZES[size]
  return {
    size,
    width: s.width,
    height: s.height,
    orientation: 'portrait',
    margins: { ...MARGIN_PRESETS[margins].margins, header: 36, footer: 36, gutter: 0 },
    background: null
  }
}

export function withOrientation(page: PageSetup, orientation: Orientation): PageSetup {
  if (page.orientation === orientation) return page
  return { ...page, orientation, width: page.height, height: page.width }
}

export function withSize(page: PageSetup, size: Exclude<PageSizeId, 'custom'>): PageSetup {
  const s = PAGE_SIZES[size]
  const [w, h] = page.orientation === 'landscape' ? [s.height, s.width] : [s.width, s.height]
  return { ...page, size, width: w, height: h }
}

export type Align = 'left' | 'center' | 'right' | 'justify'

export interface RunProps {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  caps?: boolean
  smallCaps?: boolean
  letterSpacing?: number
}

export interface ParaProps {
  align?: Align
  lineHeight?: number
  spaceBefore?: number
  spaceAfter?: number
  indentLeft?: number
  indentRight?: number
  indentFirst?: number
  keepNext?: boolean
  keepLines?: boolean
  pageBreakBefore?: boolean
}

export interface StyleDef {
  id: string
  name: string
  type: 'paragraph' | 'character'
  basedOn?: string
  next?: string
  run?: RunProps
  para?: ParaProps
  /** Outline level for heading styles (1-9). */
  outline?: number
  builtin?: boolean
  hidden?: boolean
}

export type StyleMap = Record<string, StyleDef>

export interface DocMeta {
  title?: string
  subject?: string
  author?: string
  keywords?: string
  description?: string
  created?: string
  modified?: string
}

const H = (level: number, size: number, extra: Partial<RunProps> = {}, before = 12, after = 4): StyleDef => ({
  id: `Heading${level}`,
  name: `Heading ${level}`,
  type: 'paragraph',
  basedOn: 'Normal',
  next: 'Normal',
  outline: level,
  builtin: true,
  run: { fontSize: size, bold: level <= 5, color: '#1c1c22', ...extra },
  para: { spaceBefore: before, spaceAfter: after, keepNext: true, keepLines: true, lineHeight: 1.05 }
})

export function defaultStyles(font = 'Calibri', size = 11): StyleMap {
  const list: StyleDef[] = [
    { id: 'Normal', name: 'Normal', type: 'paragraph', builtin: true, run: { fontFamily: font, fontSize: size, color: '#000000' }, para: { lineHeight: 1.15, spaceAfter: 8 } },
    { id: 'Title', name: 'Title', type: 'paragraph', basedOn: 'Normal', next: 'Normal', builtin: true, run: { fontSize: 28, letterSpacing: -0.5 }, para: { spaceAfter: 6, lineHeight: 1 } },
    { id: 'Subtitle', name: 'Subtitle', type: 'paragraph', basedOn: 'Normal', next: 'Normal', builtin: true, run: { fontSize: 15, color: '#595966' }, para: { spaceAfter: 10 } },
    H(1, 20, {}, 18, 6),
    H(2, 16, {}, 14, 4),
    H(3, 13.5, {}, 12, 4),
    H(4, 12, {}, 10, 2),
    H(5, 11, {}, 10, 2),
    H(6, 11, { bold: true, italic: true }, 8, 2),
    H(7, 11, { italic: true }, 8, 2),
    H(8, 10.5, { italic: true, color: '#3a3a44' }, 8, 2),
    H(9, 10.5, { italic: true, color: '#55555f' }, 8, 2),
    { id: 'Quote', name: 'Quote', type: 'paragraph', basedOn: 'Normal', next: 'Normal', builtin: true, run: { italic: true, color: '#44444f' }, para: { indentLeft: 36, indentRight: 36, spaceBefore: 6 } },
    { id: 'Caption', name: 'Caption', type: 'paragraph', basedOn: 'Normal', next: 'Normal', builtin: true, run: { fontSize: 9, italic: true, color: '#44444f' }, para: { spaceAfter: 10 } },
    { id: 'NoSpacing', name: 'No Spacing', type: 'paragraph', basedOn: 'Normal', builtin: true, para: { spaceAfter: 0, lineHeight: 1 } },
    { id: 'FootnoteText', name: 'Footnote Text', type: 'paragraph', basedOn: 'Normal', builtin: true, hidden: true, run: { fontSize: 9 }, para: { spaceAfter: 0, lineHeight: 1 } },
    { id: 'TOCHeading', name: 'TOC Heading', type: 'paragraph', basedOn: 'Normal', next: 'Normal', builtin: true, run: { fontSize: 16, bold: true, color: '#1c1c22' }, para: { spaceBefore: 12, spaceAfter: 8, keepNext: true } }
  ]
  return Object.fromEntries(list.map((s) => [s.id, s]))
}

/** Resolve a style's properties through its basedOn chain (cycle-safe). */
export function resolveStyle(styles: StyleMap, id: string): { run: RunProps; para: ParaProps } {
  const chain: StyleDef[] = []
  const seen = new Set<string>()
  let cur: StyleDef | undefined = styles[id]
  while (cur && !seen.has(cur.id)) {
    chain.unshift(cur)
    seen.add(cur.id)
    cur = cur.basedOn ? styles[cur.basedOn] : undefined
  }
  if (id !== 'Normal' && !seen.has('Normal') && styles.Normal && chain[0]?.type !== 'character') chain.unshift(styles.Normal)
  const run: RunProps = {}
  const para: ParaProps = {}
  for (const s of chain) {
    Object.assign(run, s.run)
    Object.assign(para, s.para)
  }
  return { run, para }
}

export const DEFAULT_TAB_STOP = 36

/** Block content (editor JSON) for each header/footer variant. */
export interface HFVariants {
  default?: unknown[] | null
  first?: unknown[] | null
  even?: unknown[] | null
}

export interface HeadersFooters {
  header: HFVariants
  footer: HFVariants
  differentFirst: boolean
  differentOddEven: boolean
}

export type HFKind = 'header' | 'footer'
export type HFVariant = 'default' | 'first' | 'even'

export const emptyHF = (): HeadersFooters => ({ header: {}, footer: {}, differentFirst: false, differentOddEven: false })

/** Which variant applies to a 0-based page index. */
export function hfVariantFor(hf: HeadersFooters, pageIndex: number): HFVariant {
  if (hf.differentFirst && pageIndex === 0) return 'first'
  if (hf.differentOddEven && pageIndex % 2 === 1) return 'even'
  return 'default'
}
