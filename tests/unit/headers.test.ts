import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { exportDocx } from '@/formats/docx/write'
import { importDocx } from '@/formats/docx/read'
import { richDoc, PNG } from './helpers/sample'
import { hfVariantFor, type HeadersFooters } from '@/editor/model'

const para = (...content: JSONContent[]): JSONContent[] => [{ type: 'paragraph', content }]
const t = (text: string): JSONContent => ({ type: 'text', text })
const f = (kind: string): JSONContent => ({ type: 'field', attrs: { kind } })

describe('headers and footers', () => {
  const doc = richDoc()
  const hf: HeadersFooters = {
    header: { default: para(t('Quarterly Report — '), f('title')), first: para(t('Cover header')), even: para(t('Even header')) },
    footer: { default: para(t('Page '), f('page'), t(' of '), f('pages')), first: null },
    differentFirst: true,
    differentOddEven: true
  }
  doc.attrs!.hf = hf
  doc.attrs!.page.numbering = { format: 'i', start: 3 }
  doc.content!.push({ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'x' } }] })
  hf.header.default!.push({ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'logo', width: 20, height: 20 } }] })

  const out = exportDocx(doc)
  const zip = unzipSync(out.data)

  it('writes header/footer parts, references, titlePg, page numbering and odd/even setting', () => {
    const xml = strFromU8(zip['word/document.xml'])
    expect(xml.match(/<w:headerReference/g)).toHaveLength(3)
    expect(xml.match(/<w:footerReference/g)).toHaveLength(1)
    expect(xml).toContain('<w:titlePg/>')
    expect(xml).toContain('<w:pgNumType w:fmt="lowerRoman" w:start="3"/>')
    expect(strFromU8(zip['word/settings.xml'])).toContain('<w:evenAndOddHeaders/>')
    const footer = Object.keys(zip).find((k) => /word\/footer\d\.xml$/.test(k))!
    expect(strFromU8(zip[footer])).toContain(' PAGE ')
    expect(strFromU8(zip[footer])).toContain(' NUMPAGES ')
    // header image gets its own part relationships
    const hdrRels = Object.keys(zip).filter((k) => /word\/_rels\/header\d\.xml\.rels$/.test(k))
    expect(hdrRels.some((k) => strFromU8(zip[k]).includes('media/'))).toBe(true)
  })

  it('round-trips headers, footers, fields and numbering', () => {
    const back = importDocx(out.data).doc
    const got = back.attrs!.hf as HeadersFooters
    expect(got.differentFirst).toBe(true)
    expect(got.differentOddEven).toBe(true)
    const fields = (c: unknown[] | null | undefined) => JSON.stringify(c).match(/"kind":"(\w+)"/g)
    expect(fields(got.footer.default)).toEqual(['"kind":"page"', '"kind":"pages"'])
    expect(fields(got.header.default)).toEqual(['"kind":"title"'])
    expect(JSON.stringify(got.header.first)).toContain('Cover header')
    expect(JSON.stringify(got.header.even)).toContain('Even header')
    expect(JSON.stringify(got.header.default)).toContain('data:image/png')
    expect(back.attrs!.page.numbering).toEqual({ format: 'i', start: 3 })
  })

  it('selects the right variant per page', () => {
    expect(hfVariantFor(hf, 0)).toBe('first')
    expect(hfVariantFor(hf, 1)).toBe('even')
    expect(hfVariantFor(hf, 2)).toBe('default')
    expect(hfVariantFor({ ...hf, differentFirst: false }, 0)).toBe('default')
  })
})

describe('table of contents', () => {
  const doc = richDoc()
  doc.content!.splice(1, 0, { type: 'paragraph', attrs: { styleId: 'TOCHeading' }, content: [{ type: 'text', text: 'Contents' }] }, {
    type: 'toc',
    attrs: { maxLevel: 2 },
    content: [
      { type: 'tocEntry', attrs: { level: 1, page: '1', target: 0 }, content: [{ type: 'text', text: 'Introduction' }] },
      { type: 'tocEntry', attrs: { level: 2, page: '1', target: 1 }, content: [{ type: 'text', text: 'Lists' }] },
      { type: 'tocEntry', attrs: { level: 1, page: '2', target: 3 }, content: [{ type: 'text', text: 'After the break' }] }
    ]
  })
  const out = exportDocx(doc).data

  it('writes a Word TOC content control with a TOC field and dot-leader tabs', () => {
    const xml = strFromU8(unzipSync(out)['word/document.xml'])
    expect(xml).toContain('<w:docPartGallery w:val="Table of Contents"/>')
    expect(xml).toContain('TOC \\o "1-2" \\h \\z \\u')
    expect(xml).toContain('w:leader="dot"')
    expect(strFromU8(unzipSync(out)['word/styles.xml'])).toContain('<w:name w:val="toc 2"/>')
  })

  it('reads it back as a toc node with levels and page numbers', () => {
    const back = importDocx(out).doc
    const toc = back.content!.find((n) => n.type === 'toc')!
    expect(toc.attrs!.maxLevel).toBe(2)
    expect(toc.content!.map((e) => [e.attrs!.level, e.content?.[0]?.text, e.attrs!.page])).toEqual([
      [1, 'Introduction', '1'],
      [2, 'Lists', '1'],
      [1, 'After the break', '2']
    ])
    expect(back.content!.some((n) => n.attrs?.styleId === 'TOCHeading')).toBe(true)
  })
})
