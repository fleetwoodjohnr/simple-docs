import { useMemo } from 'react'
import { createDocEditor, emptyDoc } from '@/editor/create'
import { DocumentView } from './DocumentView'

const lorem = 'Simple Docs lays out text on real pages. Content flows from one sheet to the next, paragraphs split between lines with widow and orphan control, and headings stay with the paragraph that follows them. '
function sample() {
  const c: any[] = [{ type: 'paragraph', attrs: { styleId: 'Title' }, content: [{ type: 'text', text: 'Pagination test' }] }]
  for (let s = 1; s <= 6; s++) {
    c.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Section ${s}` }] })
    for (let p = 0; p < 4; p++) c.push({ type: 'paragraph', content: [{ type: 'text', text: lorem.repeat(2 + ((s + p) % 4)) }] })
    c.push({ type: 'orderedList', content: [1, 2, 3].map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `List item ${i} ` + lorem }] }] })) })
    c.push({ type: 'table', content: Array.from({ length: 6 }, (_, r) => ({ type: 'tableRow', content: [0, 1, 2].map((cc) => ({ type: r ? 'tableCell' : 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: `R${r}C${cc}` }] }] })) })) })
  }
  return emptyDoc({}, c)
}

export function App() {
  const editor = useMemo(() => {
    const e = createDocEditor({ content: sample(), placeholder: 'Start writing…' })
    ;(window as any).__editor = e
    return e
  }, [])
  return (
    <div className="h-full">
      <DocumentView tabId="t1" editor={editor} zoom={1} showMarks={false} showBoundaries />
    </div>
  )
}
