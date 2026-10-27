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
