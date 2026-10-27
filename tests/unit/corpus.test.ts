// @vitest-environment jsdom
// Compatibility regression corpus: every template plus a "kitchen sink" document go through each
// format and back; the result is compared with a reviewed golden file (tests/unit/__corpus__/).
// A change in what survives a round trip shows up as a diff of those files.
// Our DOCX/ODT are also re-saved by LibreOffice (an independent writer) and read back.
import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { JSONContent } from '@tiptap/core'
import { normalizeDoc } from '@/editor/create'
import { TEMPLATES } from '@/editor/templates'
import { exportBytes, importBytes, type LibreOfficeBridge } from '@/formats/registry'
import type { FormatId } from '@/formats/types'

const noLo: LibreOfficeBridge = { available: async () => false, convert: async () => new Uint8Array() }
const hasSoffice = (() => {
  try {
    execFileSync('soffice', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...c: JSONContent[]): JSONContent => ({ type: 'paragraph', content: c })
const cell = (text: string, header = false, attrs: Record<string, unknown> = {}): JSONContent => ({ type: header ? 'tableHeader' : 'tableCell', attrs, content: [p(t(text))] })

const KITCHEN_SINK: JSONContent = {
  type: 'doc',
  attrs: {
    meta: { title: 'Kitchen sink', author: 'Corpus' },
    sources: { Lov43: { type: 'book', authors: ['Lovelace, Ada'], title: 'Notes', year: '1843', publisher: 'Taylor' } },
    citationStyle: 'apa',
    mergeData: { name: 'people.csv', fields: ['Name', 'City'], rows: [{ Name: 'Ada', City: 'London' }, { Name: 'Grace, "Amazing"', City: 'Arlington' }] },
    comments: { c1: { author: 'Reviewer', date: '2026-01-01T00:00:00.000Z', text: 'Check this', resolved: false, replies: [] } }
  },
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Kitchen sink')] },
    p(t('Plain, '), t('bold', [{ type: 'bold' }]), t(', '), t('italic', [{ type: 'italic' }]), t(', '), t('underlined', [{ type: 'underline' }]), t(', '), t('red', [{ type: 'textStyle', attrs: { color: '#c00000' } }]), t(' and '), t('a link', [{ type: 'link', attrs: { href: 'https://example.org' } }]), t('.')),
    p(t('Commented text', [{ type: 'comment', attrs: { id: 'c1' } }]), t(' then '), t('inserted', [{ type: 'insertion', attrs: { author: 'A', date: '2026-01-01T00:00:00.000Z' } }]), t(' and '), t('deleted', [{ type: 'deletion', attrs: { author: 'A', date: '2026-01-01T00:00:00.000Z' } }]), t(' words.')),
    { type: 'heading', attrs: { level: 2 }, content: [t('Lists')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('One')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Nested'))] }] }] }, { type: 'listItem', content: [p(t('Two'))] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('Third'))] }, { type: 'listItem', content: [p(t('Fourth'))] }] },
    { type: 'heading', attrs: { level: 2 }, content: [t('Table')] },
    { type: 'table', content: [{ type: 'tableRow', content: [cell('Item', true), cell('Qty', true)] }, { type: 'tableRow', content: [cell('Merged', false, { colspan: 2 })] }, { type: 'tableRow', content: [cell('Apples'), cell('4')] }] },
    p(t('Footnote here'), { type: 'footnote', attrs: { kind: 'footnote', content: [p(t('The note.'))] } }, t('.')),
    p(t('Energy '), { type: 'equation', attrs: { latex: 'E=mc^2' } }, t(' and a citation '), { type: 'citation', attrs: { source: 'Lov43', pages: '12', text: '(Lovelace, 1843, p. 12)' } }, t('.')),
    p(t('Dear '), { type: 'mergeField', attrs: { name: 'Name' } }, t(',')),
    { type: 'pageBreak' },
    p(t('Second page.'))
  ]
}

// Templates insert today's date: pin the clock so the goldens are stable.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
const CORPUS: [string, JSONContent][] = [['kitchen-sink', KITCHEN_SINK], ...TEMPLATES.map((tpl): [string, JSONContent] => [tpl.id, { type: 'doc', content: tpl.build() }])]

/** Readable outline of what a document contains: block types and text with inline features. */
function outline(doc: JSONContent): string {
  const lines: string[] = []
  const inline = (n: JSONContent): string => {
    if (n.type === 'text') {
      const marks = (n.marks ?? []).map((m) => m.type)
      return marks.length ? `[${n.text}]{${marks.join(',')}}` : n.text!
    }
    if (n.type === 'equation') return `⟨math ${n.attrs?.latex}⟩`
    if (n.type === 'citation') return `⟨cite ${n.attrs?.source} ${n.attrs?.text}⟩`
    if (n.type === 'mergeField') return `⟨field ${n.attrs?.name}⟩`
    if (n.type === 'footnote') return `⟨note ${((n.attrs?.content as JSONContent[]) ?? []).map((b) => (b.content ?? []).map(inline).join('')).join(' ')}⟩`
    if (n.type === 'hardBreak') return '⏎'
    return `⟨${n.type}⟩`
  }
  const walk = (n: JSONContent, depth: number) => {
    const pad = '  '.repeat(depth)
    if (n.content && n.content.every((c) => c.type === 'text' || ['equation', 'citation', 'mergeField', 'footnote', 'hardBreak', 'image', 'field', 'preservedInline'].includes(c.type ?? ''))) {
      const tag = n.type === 'heading' ? `h${n.attrs?.level}` : n.type
      lines.push(`${pad}${tag}${n.attrs?.styleId ? `(${n.attrs.styleId})` : ''}: ${n.content.map(inline).join('')}`)
      return
    }
    if (!n.content?.length) {
      lines.push(`${pad}${n.type}`)
      return
    }
    lines.push(`${pad}${n.type}${n.type === 'orderedList' && (n.attrs?.start ?? 1) !== 1 ? `(start ${n.attrs?.start})` : ''}${(n.attrs?.colspan ?? 1) > 1 ? `(colspan ${n.attrs?.colspan})` : ''}`)
    n.content.forEach((c) => walk(c, depth + 1))
  }
  ;(doc.content ?? []).forEach((c) => walk(c, 0))
  return lines.join('\n') + '\n'
}

const FORMATS: FormatId[] = ['docx', 'odt', 'md', 'html', 'txt']

describe('compatibility corpus (golden round trips)', () => {
  for (const [name, json] of CORPUS)
    for (const fmt of FORMATS)
      it(`${name} → ${fmt} → back`, async () => {
        const doc = normalizeDoc(json)
        const out = await exportBytes(fmt, doc, null, noLo)
        const back = await importBytes(fmt, out.data, noLo)
        const warnings = [...new Set(out.warnings.map((w) => `${w.level}: ${w.message}`))].sort()
        const a = back.doc.attrs ?? {}
        const data = `sources: ${Object.keys(a.sources ?? {}).join(', ') || 'none'} · recipients: ${a.mergeData ? `${a.mergeData.rows.length} rows of ${a.mergeData.fields.join(', ')}` : 'none'}`
        await expect(`# export warnings\n${warnings.join('\n') || '(none)'}\n\n# document data\n${data}\n\n# after round trip\n${outline(back.doc)}`).toMatchFileSnapshot(`__corpus__/${name}.${fmt}.txt`)
      })
})

describe.skipIf(!hasSoffice)('LibreOffice re-save (independent writer)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-corpus-'))
  const profile = mkdtempSync(path.join(tmpdir(), 'sd-lo-'))
  for (const fmt of ['docx', 'odt'] as const)
    it(`kitchen sink: our ${fmt} → LibreOffice → ${fmt} → ours keeps the text`, async () => {
      const doc = normalizeDoc(KITCHEN_SINK)
      const ours = await exportBytes(fmt, doc, null, noLo)
      const src = path.join(dir, `ours.${fmt}`)
      writeFileSync(src, ours.data)
      const outDir = path.join(dir, `lo-${fmt}`)
      execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${profile}`, '--convert-to', fmt === 'docx' ? 'docx:MS Word 2007 XML' : 'odt', '--outdir', outDir, src], { stdio: 'ignore', timeout: 120_000 })
      const resaved = path.join(outDir, `ours.${fmt}`)
      expect(existsSync(resaved)).toBe(true)
      const back = (await importBytes(fmt, readFileSync(resaved), noLo)).doc
      const text = (j: JSONContent): string => (j.text ?? '') + (j.content ?? []).map(text).join(j.type === 'doc' ? '\n' : '')
      const words = (s: string) => s.replace(/\s+/g, ' ').trim()
      for (const piece of ['Kitchen sink', 'Plain, bold, italic, underlined, red and a link.', 'Nested', 'Fourth', 'Merged', 'Apples', 'Second page.', 'Dear'])
        expect(words(text(back))).toContain(piece)
      // LibreOffice carries custom XML parts through a DOCX re-save (ODT never had them).
      if (fmt === 'docx') expect(back.attrs?.mergeData?.rows).toHaveLength(2)
    }, 180_000)
})
