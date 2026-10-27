import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { unzipSync, strFromU8 } from 'fflate'
import { importDocx } from '@/formats/docx/read'
import { exportDocx } from '@/formats/docx/write'
import { createExtensions } from '@/editor/extensions'

// complex.docx is produced by LibreOffice from tests/fixtures/src/complex.fodt (npm run fixtures),
// so this exercises a DOCX we did not write ourselves.
const fixture = readFileSync(path.join(import.meta.dirname, '../fixtures/complex.docx'))
const schema = getSchema(createExtensions())
const all = (n: JSONContent, pred: (x: JSONContent) => boolean, out: JSONContent[] = []): JSONContent[] => {
  if (pred(n)) out.push(n)
  n.content?.forEach((c) => all(c, pred, out))
  return out
}
const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')

describe('third-party DOCX (LibreOffice-authored)', () => {
  const { doc, warnings, carry } = importDocx(fixture)

  it('is valid for the editor schema', () => {
    expect(() => Node.fromJSON(schema, doc).check()).not.toThrow()
  })

  it('maps styles, headings and title', () => {
    expect(doc.content![0]).toMatchObject({ type: 'paragraph', attrs: { styleId: 'Title' } })
    expect(all(doc, (n) => n.type === 'heading').map((h) => [h.attrs!.level, text(h)])).toEqual([
      [1, 'Introduction'],
      [2, 'Lists'],
      [2, 'Data']
    ])
  })

  it('keeps inline formatting and links', () => {
    const marks = (s: string) => all(doc, (n) => n.type === 'text' && n.text === s)[0]?.marks?.map((m) => m.type)
    expect(marks('bold words')).toContain('bold')
    expect(marks('italic words')).toContain('italic')
    const red = all(doc, (n) => n.text === 'red underlined')[0]
    expect(red.marks!.map((m) => m.type)).toContain('underline')
    expect(red.marks!.find((m) => m.type === 'textStyle')!.attrs!.color).toBe('#c00000')
    expect(all(doc, (n) => n.text === 'hyperlink')[0].marks![0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.org/' } })
    expect(all(doc, (n) => n.attrs?.align === 'center').length).toBeGreaterThan(0)
  })

  it('rebuilds nested and numbered lists', () => {
    const bullets = all(doc, (n) => n.type === 'bulletList')
    expect(text(bullets[0])).toContain('Nested bullet')
    expect(bullets.length).toBe(2)
    expect(all(doc, (n) => n.type === 'orderedList').map(text)).toEqual(['Number oneNumber two'])
  })

  it('keeps table merges, header row and shading', () => {
    const table = all(doc, (n) => n.type === 'table')[0]
    expect(table.content![0].content!.map(text)).toEqual(['Item', 'Qty', 'Note'])
    expect(table.content![0].content![0].attrs!.background).toBe('#dde8ff')
    expect(table.content![1].content![0].attrs!.colspan).toBe(2)
    expect(table.content![1].content![1].attrs!.rowspan).toBe(2)
  })

  it('imports images and page breaks before paragraphs', () => {
    expect(all(doc, (n) => n.type === 'image')[0].attrs!.src).toMatch(/^data:image\/png;base64,/)
    const i = doc.content!.findIndex((n) => n.type === 'pageBreak')
    expect(i).toBeGreaterThan(0)
    expect(text(doc.content![i + 1])).toBe('Second page starts here.')
  })

  it('imports the footnote as editable content', () => {
    const note = all(doc, (n) => n.type === 'footnote')
    expect(note).toHaveLength(1)
    expect(note[0].attrs!.kind).toBe('footnote')
    expect(text({ content: note[0].attrs!.content } as JSONContent)).toBe('A footnote body.')
  })

  it('imports headers and footers as editable content with a live page field', () => {
    const hf = doc.attrs!.hf as { header: { default: JSONContent[] }; footer: { default: JSONContent[] } }
    expect(text({ content: hf.header.default } as JSONContent)).toBe('Fixture header text')
    const footer = { content: hf.footer.default } as JSONContent
    expect(all(footer, (n) => n.type === 'field').map((f) => f.attrs!.kind)).toEqual(['page'])
    expect(text(footer)).toContain('Page')
  })

  it('writes headers, footers and footnotes back on save', () => {
    const out = unzipSync(exportDocx(doc, carry as never).data)
    const docXml = strFromU8(out['word/document.xml'])
    expect(docXml).toMatch(/<w:headerReference [^>]*r:id="([^"]+)"/)
    const rels = strFromU8(out['word/_rels/document.xml.rels'])
    const hdrId = /<w:headerReference [^>]*r:id="([^"]+)"/.exec(docXml)![1]
    const target = new RegExp(`Id="${hdrId}"[^>]*Target="([^"]+)"`).exec(rels)![1]
    expect(strFromU8(out[`word/${target}`])).toContain('Fixture header text')
    expect(docXml).toContain('w:footnoteReference')
    expect(strFromU8(out['word/footnotes.xml'])).toContain('A footnote body.')
    expect(strFromU8(out['[Content_Types].xml'])).toContain('/word/footnotes.xml')
    // and it still imports cleanly
    expect(() => Node.fromJSON(schema, importDocx(exportDocx(doc, carry as never).data).doc).check()).not.toThrow()
  })
})

describe('preserved content safety', () => {
  it('falls back to text when referenced parts are missing (e.g. pasted into another document)', () => {
    const raw = '<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rId99"/></w:drawing></w:r>'
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'preservedInline', attrs: { format: 'docx', label: 'Chart', raw, text: 'Sales chart' } }] }] }
    const { data, warnings } = exportDocx(doc, null)
    const xml = strFromU8(unzipSync(data)['word/document.xml'])
    expect(xml).not.toContain('rId99')
    expect(xml).toContain('Sales chart')
    expect(warnings.map((w) => w.message).join()).toMatch(/could not be written back/)
  })
})

describe('footnotes and endnotes', () => {
  const note = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Claim' }, { type: 'footnote', attrs: { kind: 'footnote', content: note('Source one.') } }, { type: 'text', text: ' and more' }, { type: 'footnote', attrs: { kind: 'endnote', content: note('Closing remark.') } }] }
    ]
  }
  const out = unzipSync(exportDocx(doc).data)

  it('writes footnotes.xml / endnotes.xml with separators, references and styles', () => {
    expect(strFromU8(out['word/footnotes.xml'])).toContain('Source one.')
    expect(strFromU8(out['word/footnotes.xml'])).toContain('w:type="separator"')
    expect(strFromU8(out['word/endnotes.xml'])).toContain('Closing remark.')
    expect(strFromU8(out['word/document.xml'])).toContain('<w:footnoteReference w:id="1"/>')
    expect(strFromU8(out['word/styles.xml'])).toContain('w:styleId="FootnoteReference"')
    expect(strFromU8(out['[Content_Types].xml'])).toContain('footnotes+xml')
  })

  it('round-trips the notes as editable content', () => {
    const back = importDocx(exportDocx(doc).data).doc
    const notes = all(back, (n) => n.type === 'footnote')
    expect(notes.map((n) => [n.attrs!.kind, text({ content: n.attrs!.content } as JSONContent)])).toEqual([
      ['footnote', 'Source one.'],
      ['endnote', 'Closing remark.']
    ])
    expect(() => Node.fromJSON(schema, back).check()).not.toThrow()
  })
})

describe('comments', () => {
  const doc = {
    type: 'doc',
    attrs: {
      comments: {
        c1: { author: 'Ada Lovelace', date: '2026-01-02T03:04:05.000Z', text: 'Check this number.\nSecond line.', resolved: false, replies: [{ author: 'Grace Hopper', date: '2026-01-03T00:00:00.000Z', text: 'Verified.' }] },
        c2: { author: 'Alan Turing', date: '2026-01-04T00:00:00.000Z', text: 'Fixed typo', resolved: true, replies: [] }
      }
    },
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Revenue grew ' }, { type: 'text', text: '12%', marks: [{ type: 'comment', attrs: { id: 'c1' } }] }, { type: 'text', text: ' this year.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Spans ', marks: [{ type: 'comment', attrs: { id: 'c2' } }] }, { type: 'text', text: 'two paragraphs', marks: [{ type: 'comment', attrs: { id: 'c2' } }, { type: 'bold' }] }] }
    ]
  }
  const zip = unzipSync(exportDocx(doc).data)

  it('writes ranges, references, comments.xml and threading in commentsExtended.xml', () => {
    const xml = strFromU8(zip['word/document.xml'])
    expect(xml.match(/<w:commentRangeStart/g)).toHaveLength(3) // thread + reply + second thread
    expect(xml.match(/<w:commentReference/g)).toHaveLength(3)
    const comments = strFromU8(zip['word/comments.xml'])
    expect(comments).toContain('w:author="Ada Lovelace"')
    expect(comments).toContain('Verified.')
    expect(strFromU8(zip['word/commentsExtended.xml'])).toContain('w15:paraIdParent=')
    expect(strFromU8(zip['word/commentsExtended.xml'])).toContain('w15:done="1"')
  })

  it('round-trips threads, replies, resolved state and ranges', () => {
    const back = importDocx(exportDocx(doc).data).doc
    const threads = Object.values(back.attrs!.comments as Record<string, { author: string; text: string; resolved: boolean; replies: { author: string; text: string }[] }>)
    expect(threads.map((t) => [t.author, t.text, t.resolved, t.replies.map((r) => r.text)])).toEqual([
      ['Ada Lovelace', 'Check this number.\nSecond line.', false, ['Verified.']],
      ['Alan Turing', 'Fixed typo', true, []]
    ])
    const marked = all(back, (n) => n.type === 'text' && !!n.marks?.some((m) => m.type === 'comment')).map((n) => n.text)
    expect(marked).toEqual(['12%', 'Spans ', 'two paragraphs'])
    expect(() => Node.fromJSON(schema, back).check()).not.toThrow()
  })
})
