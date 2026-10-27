import { resolveStyle, type ParaProps, type RunProps, type StyleMap } from './model'

// Generates the stylesheet for a document's named styles. Paragraphs carry
// `data-style`; editing a style regenerates this CSS so every paragraph using it updates.

/** Approximate ratio of a font's natural line height to its em size (Word "single" spacing). */
export function lineFactor(font: string | undefined): number {
  const f = (font ?? '').toLowerCase()
  if (/calibri|carlito/.test(f)) return 1.22
  if (/cambria|caladea/.test(f)) return 1.17
  if (/courier|mono/.test(f)) return 1.13
  if (/times|liberation serif|georgia/.test(f)) return 1.15
  if (/arial|helvetica|liberation sans/.test(f)) return 1.15
  return 1.2
}

const q = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`

export const fontStack = (family: string) => `${q(family)}, var(--doc-fallback-font)`

export function runCss(r: RunProps): string[] {
  const out: string[] = []
  if (r.fontFamily) out.push(`font-family:${fontStack(r.fontFamily)}`, `--lhf:${lineFactor(r.fontFamily)}`)
  if (r.fontSize) out.push(`font-size:${r.fontSize}pt`)
  if (r.bold != null) out.push(`font-weight:${r.bold ? 700 : 400}`)
  if (r.italic != null) out.push(`font-style:${r.italic ? 'italic' : 'normal'}`)
  if (r.color) out.push(`color:${r.color}`)
  const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean)
  if (deco.length) out.push(`text-decoration:${deco.join(' ')}`)
  if (r.caps) out.push('text-transform:uppercase')
  if (r.smallCaps) out.push('font-variant-caps:small-caps')
  if (r.letterSpacing) out.push(`letter-spacing:${r.letterSpacing}pt`)
  return out
}

export function paraCss(p: ParaProps): string[] {
  const out: string[] = []
  if (p.align) out.push(`text-align:${p.align}`)
  if (p.lineHeight) out.push(`--lh:${p.lineHeight}`)
  if (p.spaceBefore != null) out.push(`padding-top:${p.spaceBefore}pt`)
  if (p.spaceAfter != null) out.push(`margin-bottom:${p.spaceAfter}pt`)
  if (p.indentLeft != null) out.push(`margin-left:${p.indentLeft}pt`)
  if (p.indentRight != null) out.push(`margin-right:${p.indentRight}pt`)
  if (p.indentFirst != null) out.push(`text-indent:${p.indentFirst}pt`)
  return out
}

export function stylesToCss(styles: StyleMap, scope: string): string {
  const rules: string[] = []
  const normal = resolveStyle(styles, 'Normal')
  rules.push(`${scope}{${runCss(normal.run).join(';')}}`)
  rules.push(`${scope} :where(p,h1,h2,h3,h4,h5,h6){${paraCss(normal.para).join(';')}}`)
  for (const s of Object.values(styles)) {
    if (s.id === 'Normal') continue
    const { run, para } = resolveStyle(styles, s.id)
    if (s.type === 'paragraph') rules.push(`${scope} [data-style=${q(s.id)}]{${[...runCss(run), ...paraCss(para)].join(';')}}`)
    else rules.push(`${scope} [data-cstyle=${q(s.id)}]{${runCss(s.run ?? {}).join(';')}}`)
  }
  return rules.join('\n')
}
