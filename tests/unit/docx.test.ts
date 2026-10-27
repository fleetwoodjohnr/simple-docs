import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { exportDocx } from '@/formats/docx/write'
import { importDocx } from '@/formats/docx/read'
import { createExtensions } from '@/editor/extensions'
import { richDoc } from './helpers/sample'

const schema = getSchema(createExtensions())
const find = (doc: JSONContent, pred: (n: JSONContent) => boolean): JSONContent[] => {
  const out: JSONContent[] = []
  const walk = (n: JSONContent) => {
    if (pred(n)) out.push(n)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}
const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')

describe('DOCX round trip', () => {
  const original = richDoc()
  const { data } = exportDocx(original)
  const { doc, warnings } = importDocx(data)

  it('produces a document valid against the editor schema', () => {
    expect(() => Node.fromJSON(schema, doc).check()).not.toThrow()
    expect(warnings.filter((w) => w.level === 'loss')).toEqual([])
  })

  it('keeps text content in order', () => {
    expect(text(doc)).toBe(text(original))
  })

  it('keeps headings, styles and paragraph formatting', () => {
    expect(doc.content![0]).toMatchObject({ type: 'paragraph', attrs: { styleId: 'Title' } })
    expect(find(doc, (n) => n.type === 'heading').map((h) => h.attrs!.level)).toEqual([1, 2, 2, 1])
    const just = find(doc, (n) => n.attrs?.align === 'justify')[0]
    expect(just.attrs).toMatchObject({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, indentFirst: 18 })
  })

  it('keeps character formatting', () => {
    const marks = (s: string) => find(doc, (n) => n.type === 'text' && n.text === s)[0]?.marks?.map((m) => m.type).sort()
    expect(marks('bold')).toEqual(['bold'])
    expect(marks('italic')).toEqual(['italic'])
    expect(marks('underlined')).toEqual(['underline'])
    expect(marks('struck')).toEqual(['strike'])
    const colored = find(doc, (n) => n.text === 'Colored ')[0]
    expect(colored.marks![0]).toMatchObject({ type: 'textStyle', attrs: { color: '#c0392b', fontFamily: 'Cambria', fontSize: '14pt' } })
    expect(find(doc, (n) => n.text === 'highlighted')[0].marks![0]).toMatchObject({ type: 'highlight', attrs: { color: '#ffff00' } })
    expect(find(doc, (n) => n.text === 'link')[0].marks![0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.com/' } })
    expect(marks('2')).toEqual(['subscript'])
  })

  it('keeps nested lists and task lists', () => {
    const bullets = find(doc, (n) => n.type === 'bulletList')
    expect(bullets).toHaveLength(2)
    expect(text(bullets[0])).toContain('Nested bullet')
    const ordered = find(doc, (n) => n.type === 'orderedList')
    expect(ordered).toHaveLength(2)
    expect(find(doc, (n) => n.type === 'taskItem').map((i) => i.attrs!.checked)).toEqual([true, false])
  })

  it('keeps table structure, merges and shading', () => {
    const table = find(doc, (n) => n.type === 'table')[0]
    expect(table.content).toHaveLength(3)
    expect(table.content![0].content!.every((c) => c.type === 'tableHeader')).toBe(true)
    expect(table.content![1].content![0].attrs).toMatchObject({ rowspan: 2, background: '#e8f0fe' })
    expect(table.content![2].content![0].attrs).toMatchObject({ colspan: 2 })
  })

  it('keeps images, page breaks, tabs, line breaks, page setup and metadata', () => {
    expect(find(doc, (n) => n.type === 'image')[0].attrs).toMatchObject({ alt: 'Red dot', width: 40, height: 40 })
    expect(find(doc, (n) => n.type === 'pageBreak')).toHaveLength(1)
    expect(find(doc, (n) => n.type === 'hardBreak')).toHaveLength(1)
    expect(text(doc)).toContain('Tab\there')
    expect(doc.attrs!.page).toMatchObject({ size: 'a4', margins: { top: 54, bottom: 54, left: 63, right: 63 } })
    expect(doc.attrs!.meta).toMatchObject({ title: 'Quarterly Report', author: 'Test Author' })
    expect(Object.values(doc.attrs!.comments as Record<string, { text: string }>).map((c) => c.text)).toEqual(['Expand this section.'])
  })

  it('is stable on a second round trip', () => {
    const again = importDocx(exportDocx(doc).data).doc
    expect(again.content).toEqual(doc.content)
  })

  const soffice = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find(existsSync)
  it.skipIf(!soffice || !existsSync('/usr/bin/pdftotext'))('opens in LibreOffice (independent consumer)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sd-docx-'))
    const file = path.join(dir, 'report.docx')
    writeFileSync(file, data)
    execFileSync(soffice!, ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, file], { timeout: 120_000 })
    const pdfText = execFileSync('pdftotext', ['-layout', path.join(dir, 'report.pdf'), '-']).toString()
    for (const s of ['Quarterly Report', 'Nested bullet', 'Sub-step', 'Merged', 'After the break', 'Footnote from the sample.']) expect(pdfText).toContain(s)
    const pages = execFileSync('pdfinfo', [path.join(dir, 'report.pdf')]).toString()
    expect(Number(/Pages:\s+(\d+)/.exec(pages)![1])).toBeGreaterThanOrEqual(2)
  }, 150_000)
})

describe('DOCX tracked changes', () => {
  const { data } = exportDocx(richDoc())
  it('writes w:ins / w:del with authors and turns on trackRevisions', async () => {
    const { unzipSync, strFromU8 } = await import('fflate')
    const zip = unzipSync(data)
    const xml = strFromU8(zip['word/document.xml'])
    expect(xml).toMatch(/<w:del w:id="\d+" w:author="Editor" w:date="2026-02-01T00:00:00Z"><w:r><w:t\b|<w:del w:id="\d+" w:author="Editor"[^>]*><w:r>.*?<w:delText/)
    expect(xml).toContain('<w:delText xml:space="preserve">removed words</w:delText>')
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="Editor"/)
    expect(strFromU8(zip['word/settings.xml'])).toMatch(/<w:trackRevisions\/>.*<w:defaultTabStop/s)
  })
  it('reads them back as revision marks', () => {
    const back = importDocx(data).doc
    expect(back.attrs!.trackChanges).toBe(true)
    const marksOf = (s: string) => find(back, (n) => n.text === s)[0]?.marks?.map((m) => [m.type, m.attrs?.author])
    expect(marksOf('removed words')).toEqual([['deletion', 'Editor']])
    expect(marksOf('added words')).toEqual([['insertion', 'Editor']])
  })
})
