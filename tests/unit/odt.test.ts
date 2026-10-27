import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { unzipSync, strFromU8 } from 'fflate'
import { importOdt } from '@/formats/odt/read'
import { exportOdt } from '@/formats/odt/write'
import { createExtensions } from '@/editor/extensions'
import { richDoc } from './helpers/sample'

const schema = getSchema(createExtensions())
const all = (n: JSONContent, pred: (x: JSONContent) => boolean, out: JSONContent[] = []): JSONContent[] => {
  if (pred(n)) out.push(n)
  n.content?.forEach((c) => all(c, pred, out))
  return out
}
const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')

describe('ODT import (LibreOffice-authored fixture)', () => {
  const { doc } = importOdt(readFileSync(path.join(import.meta.dirname, '../fixtures/complex.odt')))

  it('is valid for the editor schema', () => expect(() => Node.fromJSON(schema, doc).check()).not.toThrow())

  it('reads styles, headings, formatting, links and alignment', () => {
    expect(doc.content![0]).toMatchObject({ type: 'paragraph', attrs: { styleId: 'Title' } })
    expect(all(doc, (n) => n.type === 'heading').map((h) => [h.attrs!.level, text(h)])).toEqual([
      [1, 'Introduction'],
      [2, 'Lists'],
      [2, 'Data']
    ])
    const marks = (s: string) => all(doc, (n) => n.text === s)[0]?.marks?.map((m) => m.type)
    expect(marks('bold words')).toContain('bold')
    expect(marks('italic words')).toContain('italic')
    expect(marks('red underlined')).toContain('underline')
    expect(all(doc, (n) => n.text === 'hyperlink')[0].marks![0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.org/' } })
    expect(all(doc, (n) => n.attrs?.align === 'center').length).toBeGreaterThan(0)
  })

  it('reads lists, tables, images, footnotes, page breaks, headers/footers and metadata', () => {
    expect(text(all(doc, (n) => n.type === 'bulletList')[0])).toContain('Nested bullet')
    expect(all(doc, (n) => n.type === 'orderedList').map(text)).toEqual(['Number oneNumber two'])
    const table = all(doc, (n) => n.type === 'table')[0]
    expect(table.content![0].content!.map(text)).toEqual(['Item', 'Qty', 'Note'])
    expect(table.content![0].content!.every((c) => c.type === 'tableHeader')).toBe(true)
    expect(table.content![1].content![0].attrs).toMatchObject({ colspan: 2 })
    expect(table.content![1].content![1].attrs).toMatchObject({ rowspan: 2 })
    expect(table.content![0].content![0].attrs!.background).toBe('#dde8ff')
    expect(all(doc, (n) => n.type === 'image')[0].attrs).toMatchObject({ alt: 'Blue box' })
    expect(text({ content: all(doc, (n) => n.type === 'footnote')[0].attrs!.content } as JSONContent)).toBe('A footnote body.')
    const i = doc.content!.findIndex((n) => n.type === 'pageBreak')
    expect(text(doc.content![i + 1])).toBe('Second page starts here.')
    const hf = doc.attrs!.hf as { header: { default: JSONContent[] }; footer: { default: JSONContent[] } }
    expect(text({ content: hf.header.default } as JSONContent)).toBe('Fixture header text')
    expect(all({ content: hf.footer.default } as JSONContent, (n) => n.type === 'field').map((f) => f.attrs!.kind)).toEqual(['page'])
    expect(doc.attrs!.meta).toMatchObject({ title: 'Fixture Report', author: 'Fixture Author' })
    expect(doc.attrs!.page).toMatchObject({ size: 'letter', margins: { left: 72, right: 72 } })
  })
})

describe('ODT export', () => {
  const original = richDoc()
  const out = exportOdt(original)
  const zip = unzipSync(out.data)

  it('writes a valid package (mimetype first and stored)', () => {
    expect(Object.keys(zip)[0]).toBe('mimetype')
    expect(strFromU8(zip.mimetype)).toBe('application/vnd.oasis.opendocument.text')
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']))
    const raw = Buffer.from(out.data)
    expect(raw.subarray(30, 38).toString()).toBe('mimetype') // first local file header name
    expect(raw.readUInt16LE(8)).toBe(0) // compression method: stored
  })

  it('round-trips the rich sample', () => {
    const { doc } = importOdt(out.data)
    expect(() => Node.fromJSON(schema, doc).check()).not.toThrow()
    expect(doc.content![0]).toMatchObject({ type: 'paragraph', attrs: { styleId: 'Title' } })
    expect(all(doc, (n) => n.type === 'heading').map((h) => [h.attrs!.level, text(h)])).toEqual([
      [1, 'Introduction'],
      [2, 'Lists'],
      [2, 'Table'],
      [1, 'After the break']
    ])
    const just = all(doc, (n) => n.attrs?.align === 'justify')[0]
    expect(just.attrs).toMatchObject({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, indentFirst: 18 })
    const colored = all(doc, (n) => n.text === 'Colored ')[0]
    expect(colored.marks!.find((m) => m.type === 'textStyle')!.attrs).toMatchObject({ color: '#c0392b', fontFamily: 'Cambria', fontSize: '14pt' })
    expect(all(doc, (n) => n.text === 'link')[0].marks![0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.com/' } })
    expect(all(doc, (n) => n.type === 'bulletList')).toHaveLength(2)
    expect(all(doc, (n) => n.type === 'taskItem').map((t) => t.attrs!.checked)).toEqual([true, false])
    const table = all(doc, (n) => n.type === 'table')[0]
    expect(table.content![1].content![0].attrs).toMatchObject({ rowspan: 2, background: '#e8f0fe' })
    expect(table.content![2].content![0].attrs).toMatchObject({ colspan: 2 })
    expect(all(doc, (n) => n.type === 'image')[0].attrs).toMatchObject({ alt: 'Red dot', width: 40, height: 40 })
    expect(all(doc, (n) => n.type === 'pageBreak')).toHaveLength(1)
    expect(text({ content: all(doc, (n) => n.type === 'footnote')[0].attrs!.content } as JSONContent)).toBe('Footnote from the sample.')
    expect(Object.values(doc.attrs!.comments as Record<string, { text: string; replies: unknown[] }>).map((c) => [c.text, c.replies.length])).toEqual([['Expand this section.', 1]])
    expect(doc.attrs!.page).toMatchObject({ size: 'a4' })
    expect(doc.attrs!.meta).toMatchObject({ title: 'Quarterly Report', author: 'Test Author' })
    expect(text(doc)).toContain('Tab\there')
  })

  it('reports that tracked changes are saved as final text', () => {
    expect(out.warnings.map((w) => w.message).join()).toMatch(/Tracked changes are saved as accepted/)
  })

  const soffice = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find(existsSync)
  it.skipIf(!soffice || !existsSync('/usr/bin/pdftotext'))('opens in LibreOffice (independent consumer)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sd-odt-'))
    const file = path.join(dir, 'report.odt')
    writeFileSync(file, out.data)
    execFileSync(soffice!, ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, file], { timeout: 120_000 })
    const pdfText = execFileSync('pdftotext', ['-layout', path.join(dir, 'report.pdf'), '-']).toString()
    for (const s of ['Quarterly Report', 'Nested bullet', 'Sub-step', 'Merged', 'After the break', 'Footnote from the sample.', 'added words']) expect(pdfText).toContain(s)
    expect(pdfText).not.toContain('removed words')
  }, 150_000)
})
