// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { type JSONContent } from '@tiptap/core'
import { createExtensions } from '@/editor/extensions'
import { checkAccessibility, contrast } from '@/editor/a11y'
import { testEditor } from './editor'

const p = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text, marks }] : undefined })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : undefined })
const rules = (content: JSONContent[], attrs: Record<string, unknown> = { meta: { title: 'T' } }) =>
  checkAccessibility(testEditor({ extensions: createExtensions(), content: { type: 'doc', attrs, content } }).state.doc).map((i) => i.rule)

it('contrast ratio follows WCAG', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
  expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  expect(contrast('red', '#fff')).toBeNull()
})

it('a clean document passes', () => {
  expect(rules([h(1, 'Title'), h(2, 'Part'), p('Body text.')])).toEqual([])
})

it('flags missing alt text, skipped and empty headings, header-less tables, vague links, low contrast, blank runs and a missing title', () => {
  const found = rules(
    [
      h(1, 'Title'),
      h(3, 'Skipped'),
      h(2, ''),
      { type: 'image', attrs: { src: 'data:image/png;base64,AA==' } },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('a')] }] }] },
      p('click here', [{ type: 'link', attrs: { href: 'https://x.org' } }]),
      p('pale', [{ type: 'textStyle', attrs: { color: '#bbbbbb' } }]),
      p(''),
      p(''),
      p('')
    ],
    {}
  )
  expect(found).toEqual(expect.arrayContaining(['image-alt', 'heading-skip', 'heading-empty', 'table-header', 'link-text', 'contrast', 'blank-lines', 'title']))
  expect(found[0]).toBe('image-alt') // errors first
})

it('large text needs only 3:1 contrast', () => {
  expect(rules([p('big', [{ type: 'textStyle', attrs: { color: '#888888', fontSize: '20pt' } }])])).toEqual([])
  expect(rules([p('small', [{ type: 'textStyle', attrs: { color: '#888888', fontSize: '11pt' } }])])).toEqual(['contrast'])
})
