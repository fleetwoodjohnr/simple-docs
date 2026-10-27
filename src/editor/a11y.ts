import type { Node as PMNode } from '@tiptap/pm/model'

// Accessibility checker: pure rules over the document, in the spirit of Word's checker and WCAG 2.2.

export type A11ySeverity = 'error' | 'warning' | 'tip'
export type A11yFix = 'alt' | 'header-row' | 'title'

export interface A11yIssue {
  rule: string
  severity: A11ySeverity
  message: string
  /** Why it matters / how to fix, one sentence. */
  help: string
  /** Document position of the offending node (−1 = whole document). */
  pos: number
  fix?: A11yFix
}

const VAGUE_LINKS = /^(click here|here|link|more|read more|this|this link|learn more|go)$/i

function hexToRgb(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative-luminance contrast ratio between two hex colors (null if either is not hex). */
export function contrast(a: string, b: string): number | null {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return null
  const lum = ([r, g, bl]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
  }
  const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function checkAccessibility(doc: PMNode): A11yIssue[] {
  const issues: A11yIssue[] = []
  const pageColor = (doc.attrs.page?.background as string | null) || '#ffffff'
  let lastLevel = 0
  let headings = 0
  let words = 0
  let emptyRun = 0
  let emptyRunStart = -1
  const lowContrast = new Set<string>()

  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'image' && !String(node.attrs.alt ?? '').trim())
      issues.push({ rule: 'image-alt', severity: 'error', message: 'Image without alternative text', help: 'Screen-reader users hear nothing for this image. Describe what it shows (or mark it decorative with a single space).', pos, fix: 'alt' })

    if (name === 'heading') {
      headings++
      const level = node.attrs.level as number
      if (!node.textContent.trim()) issues.push({ rule: 'heading-empty', severity: 'warning', message: 'Empty heading', help: 'Empty headings appear in the navigation of assistive technology with no name. Add text or change it to a normal paragraph.', pos })
      else if (lastLevel && level > lastLevel + 1)
        issues.push({ rule: 'heading-skip', severity: 'warning', message: `Heading level skipped (Heading ${lastLevel} → Heading ${level})`, help: 'Headings should go down one level at a time so the outline makes sense when navigated.', pos })
      lastLevel = level
    }

    if (name === 'table') {
      const first = node.firstChild
      const hasHeader = !!first && first.childCount > 0 && first.content.content.every((c) => c.type.name === 'tableHeader')
      if (!hasHeader) issues.push({ rule: 'table-header', severity: 'warning', message: 'Table without a header row', help: 'A header row lets screen readers announce what each column means.', pos, fix: 'header-row' })
      let merged = false
      node.descendants((c) => {
        if ((c.attrs.colspan ?? 1) > 1 || (c.attrs.rowspan ?? 1) > 1) merged = true
        return !merged
      })
      if (merged) issues.push({ rule: 'table-merged', severity: 'tip', message: 'Table with merged cells', help: 'Merged cells make tables hard to follow with a screen reader. Prefer a simple grid where you can.', pos })
    }

    if (node.isTextblock) {
      if (name === 'paragraph' && node.childCount === 0) {
        if (emptyRun++ === 0) emptyRunStart = pos
        if (emptyRun === 3) issues.push({ rule: 'blank-lines', severity: 'tip', message: 'Several empty paragraphs in a row', help: 'Blank paragraphs used for spacing are announced as "blank" repeatedly. Use spacing before/after or a page break instead.', pos: emptyRunStart })
      } else emptyRun = 0
      words += node.textContent.split(/\s+/).filter(Boolean).length
    }

    if (node.isText) {
      for (const m of node.marks) {
        if (m.type.name === 'link') {
          const t = node.text!.trim()
          if (VAGUE_LINKS.test(t) || /^https?:\/\/\S{30,}$/.test(t))
            issues.push({ rule: 'link-text', severity: 'tip', message: `Link text “${t.length > 40 ? t.slice(0, 40) + '…' : t}” does not say where it goes`, help: 'Links are often read out of context. Use text that describes the destination.', pos })
        }
        if (m.type.name === 'textStyle' && m.attrs.color) {
          const ratio = contrast(m.attrs.color as string, pageColor)
          const large = /^(\d+(?:\.\d+)?)pt$/.exec(String(m.attrs.fontSize ?? ''))
          const min = large && parseFloat(large[1]) >= 18 ? 3 : 4.5
          const key = `${m.attrs.color}`
          if (ratio !== null && ratio < min && !lowContrast.has(key)) {
            lowContrast.add(key)
            issues.push({ rule: 'contrast', severity: 'warning', message: `Low text contrast (${ratio.toFixed(1)}:1, color ${m.attrs.color})`, help: `Text needs a contrast of at least ${min}:1 against the page to be readable for people with low vision.`, pos })
          }
        }
      }
    }
    return true
  })

  if (!String(doc.attrs.meta?.title ?? '').trim())
    issues.push({ rule: 'title', severity: 'tip', message: 'Document has no title', help: 'The title (File → Properties) is what assistive technology and exported PDFs announce first.', pos: -1, fix: 'title' })
  if (!headings && words > 400)
    issues.push({ rule: 'no-headings', severity: 'tip', message: 'Long document without headings', help: 'Headings let people skim and jump through the document. Use Heading styles for section titles.', pos: -1 })

  const order = { error: 0, warning: 1, tip: 2 }
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || a.pos - b.pos)
}
