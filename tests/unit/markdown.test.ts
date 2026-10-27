import { describe, expect, it } from 'vitest'
import { docToMarkdown } from '@/formats/markdown'
import { docToText } from '@/formats/text'
import { richDoc } from './helpers/sample'

describe('Markdown export', () => {
  const { markdown, warnings } = docToMarkdown(richDoc())

  it('writes GFM structures', () => {
    for (const s of ['# Quarterly Report', '# Introduction', '**bold**', '*italic*', '~~struck~~', '[link](https://example.com/)', '- First bullet', '  - Nested bullet', '1. Step one', '- [x] Done task', '| Region | Q1 | Q2 |', '![Red dot](data:image/png'])
      expect(markdown).toContain(s)
  })

  it('writes footnotes as GFM footnotes', () => {
    expect(markdown).toMatch(/Plain\[\^1\]/)
    expect(markdown).toContain('[^1]: Footnote from the sample.')
  })

  it('reports what Markdown cannot hold', () => {
    const msgs = warnings.map((w) => w.message).join('\n')
    expect(msgs).toMatch(/Underline/)
    expect(msgs).toMatch(/Page breaks/)
    expect(msgs).toMatch(/Merged table cells/)
  })
})

describe('plain text export', () => {
  it('keeps list markers, tabs between cells and notes at the end', () => {
    const txt = docToText(richDoc())
    expect(txt).toContain('• First bullet')
    expect(txt).toContain('1. Step one')
    expect(txt).toContain('Region\tQ1\tQ2')
    expect(txt).toContain('Plain[1]')
    expect(txt).toContain('[1] Footnote from the sample.')
    expect(txt).toContain('\f')
  })
})
