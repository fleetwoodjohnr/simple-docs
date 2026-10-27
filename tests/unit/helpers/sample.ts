import type { JSONContent } from '@tiptap/core'
import { emptyDoc } from '@/editor/create'
import { withOrientation, withSize, makePageSetup } from '@/editor/model'

// 1x1 red PNG
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })

/** A document exercising the M1 feature set (acceptance items 1–6). */
export function richDoc(): JSONContent {
  const doc = emptyDoc({}, [
    { type: 'paragraph', attrs: { styleId: 'Title' }, content: [t('Quarterly Report')] },
    { type: 'heading', attrs: { level: 1 }, content: [t('Introduction')] },
    p(t('Plain'), { type: 'footnote', attrs: { kind: 'footnote', content: [p(t('Footnote from the sample.'))] } }, t(', '), t('bold', [{ type: 'bold' }]), t(', '), t('italic', [{ type: 'italic' }]), t(', '), t('underlined', [{ type: 'underline' }]), t(' and '), t('struck', [{ type: 'strike' }]), t('.')),
    {
      type: 'paragraph',
      attrs: { align: 'justify', lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, indentFirst: 18 },
      content: [t('Colored ', [{ type: 'textStyle', attrs: { color: '#c0392b', fontFamily: 'Cambria', fontSize: '14pt' } }]), t('highlighted', [{ type: 'highlight', attrs: { color: '#ffff00' } }]), t(' H'), t('2', [{ type: 'subscript' }]), t('O and x'), t('2', [{ type: 'superscript' }]), t(' and a '), t('link', [{ type: 'link', attrs: { href: 'https://example.com/' } }]), t('.')]
    },
    { type: 'heading', attrs: { level: 2 }, content: [t('Lists')] },
    {
      type: 'bulletList',
      content: [li(p(t('First bullet')), { type: 'bulletList', content: [li(p(t('Nested bullet')))] }), li(p(t('Second bullet')))]
    },
    { type: 'orderedList', attrs: { start: 1, type: null }, content: [li(p(t('Step one'))), li(p(t('Step two')), { type: 'orderedList', attrs: { start: 1, type: null }, content: [li(p(t('Sub-step')))] })] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('Done task'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('Open task'))] }] },
    { type: 'heading', attrs: { level: 2 }, content: [t('Table')] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: ['Region', 'Q1', 'Q2'].map((c) => ({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t(c))] })) },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 2, colwidth: null, background: '#e8f0fe' }, content: [p(t('North'))] }, ...['10', '12'].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t(c))] }))] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [p(t('Merged'))] }] }
      ]
    },
    p(t('An image: '), { type: 'image', attrs: { src: PNG, alt: 'Red dot', width: 40, height: 40 } }),
    { type: 'pageBreak' },
    { type: 'heading', attrs: { level: 1 }, content: [t('After the break')] },
    p(t('Tab\there and a'), { type: 'hardBreak' }, t('line break.'))
  ])
  doc.attrs!.page = withOrientation(withSize(makePageSetup('a4'), 'a4'), 'portrait')
  doc.attrs!.page.margins = { ...doc.attrs!.page.margins, top: 54, bottom: 54, left: 63, right: 63 }
  doc.attrs!.meta = { title: 'Quarterly Report', author: 'Test Author' }
  return doc
}
