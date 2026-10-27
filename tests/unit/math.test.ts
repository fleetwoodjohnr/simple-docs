// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { latexToOmml, ommlToLatex } from '@/editor/math/omml'

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
const parse = (omml: string) => new DOMParser().parseFromString(omml.replace(/^<m:(oMath(Para)?)>/, `<m:$1 ${M}>`), 'application/xml').documentElement
const back = (latex: string, display = false) => ommlToLatex(parse(latexToOmml(latex, display)!))!
/** Same rendering in KaTeX (whitespace and redundant braces do not matter). */
const render = (latex: string) => katex.renderToString(latex, { output: 'mathml', throwOnError: true }).replace(/<annotation[^]*?<\/annotation>/, '')

describe('LaTeX → OMML', () => {
  it('converts the common constructs', () => {
    expect(latexToOmml('\\frac{a}{b}')).toBe('<m:oMath><m:f><m:num><m:r><m:t xml:space="preserve">a</m:t></m:r></m:num><m:den><m:r><m:t xml:space="preserve">b</m:t></m:r></m:den></m:f></m:oMath>')
    expect(latexToOmml('x^2')).toContain('<m:sSup><m:e><m:r><m:t xml:space="preserve">x</m:t></m:r></m:e><m:sup><m:r><m:t xml:space="preserve">2</m:t></m:r></m:sup></m:sSup>')
    expect(latexToOmml('x_i^2')).toContain('<m:sSubSup>')
    expect(latexToOmml('\\sqrt[3]{x}')).toContain('<m:rad><m:deg>')
    expect(latexToOmml('\\sum_{i=1}^{n} i')).toContain('<m:chr m:val="∑"/>')
    expect(latexToOmml('\\left( x \\right)')).toContain('<m:begChr m:val="("/>')
    expect(latexToOmml('\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}')).toContain('<m:count m:val="2"/>')
    expect(latexToOmml('\\hat{x} + \\alpha \\leq \\infty')).toContain('α')
    expect(latexToOmml('\\text{if } x', true)).toContain('<m:oMathPara><m:oMath>')
    expect(latexToOmml('\\text{if } x')).toContain('<m:t xml:space="preserve">if </m:t>')
  })

  it('returns null for unsupported input instead of guessing', () => {
    expect(latexToOmml('\\unknowncommand{x}')).toBeNull()
    expect(latexToOmml('\\frac{a}{b')).toBeNull()
    expect(latexToOmml('\\begin{align} x \\end{align}')).toBeNull()
  })
})

describe('OMML → LaTeX', () => {
  const cases = [
    'E = mc^2',
    'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
    '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}',
    '\\left[ \\begin{matrix} a & b \\\\ c & d \\end{matrix} \\right]',
    '\\hat{\\theta} \\neq \\overline{x}_n',
    '\\sin \\alpha + \\cos \\beta',
    '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
    'f(x) = \\text{constant}'
  ]
  for (const latex of cases)
    it(`round-trips ${latex}`, () => {
      const r = back(latex)
      expect(render(r.latex)).toBe(render(latex))
    })

  it('reads a Word-authored equation (with w:rPr runs and properties)', () => {
    const word = `<m:oMathPara ${M} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><m:oMath><m:sSup><m:sSupPr><m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr></m:ctrlPr></m:sSupPr><m:e><m:r><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>a</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>+</m:t></m:r><m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>=</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara>`
    const el = new DOMParser().parseFromString(word, 'application/xml').documentElement
    expect(ommlToLatex(el)).toEqual({ latex: 'a^2+b^2=c^2', display: true })
  })

  it('returns null for constructs it cannot represent', () => {
    const el = new DOMParser().parseFromString(`<m:oMath ${M}><m:mysteryThing/></m:oMath>`, 'application/xml').documentElement
    expect(ommlToLatex(el)).toBeNull()
  })
})

describe('equations in documents', async () => {
  const { Editor } = await import('@tiptap/core')
  const { createExtensions } = await import('@/editor/extensions')
  const { exportDocx } = await import('@/formats/docx/write')
  const { importDocx } = await import('@/formats/docx/read')
  const { exportMarkdown, importMarkdown } = await import('@/formats/markdown')
  const { strFromU8, unzipSync } = await import('fflate')
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Energy ' }, { type: 'equation', attrs: { latex: 'E=mc^2' } }, { type: 'text', text: ' holds.' }] },
      { type: 'paragraph', content: [{ type: 'equation', attrs: { latex: '\\frac{a}{b}', display: true } }] }
    ]
  }

  it('renders with KaTeX (MathML for assistive technology)', () => {
    const e = new Editor({ extensions: createExtensions(), content: doc })
    const eq = e.view.dom.querySelector('.sd-equation')!
    expect(eq.querySelector('.katex')).not.toBeNull()
    expect(eq.querySelector('math annotation')?.textContent).toBe('E=mc^2')
  })

  it('round-trips through DOCX as Office Math', () => {
    const e = new Editor({ extensions: createExtensions(), content: doc })
    const bytes = exportDocx(e.getJSON()).data
    const xmlText = strFromU8(unzipSync(bytes)['word/document.xml'])
    expect(xmlText).toContain('<m:oMath><m:r><m:t xml:space="preserve">E=m</m:t></m:r><m:sSup><m:e><m:r><m:t xml:space="preserve">c</m:t></m:r></m:e>')
    expect(xmlText).toContain('<m:oMathPara><m:oMath><m:f>')
    const back = importDocx(bytes).doc
    const eqs = back.content!.flatMap((p) => p.content ?? []).filter((n) => n.type === 'equation')
    expect(eqs.map((n) => [n.attrs!.latex, n.attrs!.display])).toEqual([
      ['E=mc^2', false],
      ['\\frac{a}{b}', true]
    ])
    // unedited imported equations are written back byte-for-byte
    const again = strFromU8(unzipSync(exportDocx(back).data)['word/document.xml'])
    expect(again).toContain(eqs[0].attrs!.omml)
  })

  it('round-trips through Markdown as $…$ and $$…$$, leaving prices alone', () => {
    const e = new Editor({ extensions: createExtensions(), content: doc })
    const text = new TextDecoder().decode(exportMarkdown(e.getJSON()).data)
    expect(text).toContain('Energy $E=mc^2$ holds.')
    expect(text).toContain('$$\\frac{a}{b}$$')
    const back = importMarkdown(new TextEncoder().encode(text + '\n\nIt costs $5 and $10.\n')).doc
    const flat = JSON.stringify(back)
    expect(flat).toContain('"latex":"E=mc^2"')
    expect(flat).toContain('"latex":"\\\\frac{a}{b}","display":true')
    expect(flat).toContain('It costs $5 and $10.')
  })
})
