// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { createExtensions } from '@/editor/extensions'
import { distributeColumns, setTableStyle, sortTable, tableToText, textToTable } from '@/editor/tables'
import { exportDocx } from '@/formats/docx/write'
import { importDocx } from '@/formats/docx/read'
import { exportOdt } from '@/formats/odt/write'
import { importOdt } from '@/formats/odt/read'

const cell = (t: string, h = false): JSONContent => ({ type: h ? 'tableHeader' : 'tableCell', attrs: { colwidth: [120] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const table = (rows: string[][]): JSONContent => ({ type: 'table', content: rows.map((r, i) => ({ type: 'tableRow', content: r.map((t) => cell(t, i === 0)) })) })
const make = (content: JSONContent[]) => new Editor({ extensions: createExtensions(), content: { type: 'doc', content } })
const rowsOf = (e: Editor) => {
  const out: string[][] = []
  e.state.doc.descendants((n) => {
    if (n.type.name === 'tableRow') out.push(n.content.content.map((c) => c.textContent))
    return true
  })
  return out
}
const cursorIn = (e: Editor, text: string) => {
  let pos = 0
  e.state.doc.descendants((n, p) => {
    if (!pos && n.isText && n.text === text) pos = p + 1
  })
  e.commands.setTextSelection(pos)
}

describe('table tools', () => {
  it('sorts body rows by the current column (numbers numerically), keeping the header', () => {
    const e = make([table([['Name', 'Qty'], ['pear', '10'], ['Apple', '9'], ['banana', '100']])])
    cursorIn(e, '10')
    expect(sortTable(e)).toBeNull()
    expect(rowsOf(e)).toEqual([['Name', 'Qty'], ['Apple', '9'], ['pear', '10'], ['banana', '100']])
    cursorIn(e, 'pear')
    sortTable(e, true)
    expect(rowsOf(e).map((r) => r[0])).toEqual(['Name', 'pear', 'banana', 'Apple'])
  })

  it('refuses to sort tables with vertical merges', () => {
    const t = table([['A', 'B'], ['1', '2'], ['3', '4']])
    t.content![1].content![0].attrs = { rowspan: 2 }
    t.content![2].content!.shift()
    const e = make([t])
    cursorIn(e, '2')
    expect(sortTable(e)).toMatch(/merged/)
  })

  it('distributes columns evenly', () => {
    const e = make([table([['A', 'B'], ['1', '2']])])
    cursorIn(e, 'A')
    distributeColumns(e)
    let widths = 0
    e.state.doc.descendants((n) => {
      if (n.attrs.colwidth) widths++
    })
    expect(widths).toBe(0)
  })

  it('converts tab-separated paragraphs to a table and back, keeping formatting', () => {
    const e = make([
      { type: 'paragraph', content: [{ type: 'text', text: 'Name\tScore' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ada', marks: [{ type: 'bold' }] }, { type: 'text', text: '\t99' }] }
    ])
    e.commands.selectAll()
    expect(textToTable(e)).toBeNull()
    expect(rowsOf(e)).toEqual([['Name', 'Score'], ['Ada', '99']])
    let bold = false
    e.state.doc.descendants((n) => {
      if (n.isText && n.text === 'Ada') bold = n.marks.some((m) => m.type.name === 'bold')
    })
    expect(bold).toBe(true)
    cursorIn(e, 'Ada')
    tableToText(e)
    expect(e.getText({ blockSeparator: '\n' }).trim()).toBe('Name\tScore\nAda\t99')
  })

  it('round-trips table styles through DOCX and ODT', () => {
    for (const style of ['plain', 'lines'] as const) {
      const e = make([table([['A', 'B'], ['1', '2']])])
      cursorIn(e, 'A')
      setTableStyle(e, style)
      const json = e.getJSON()
      const back = importDocx(exportDocx(json).data).doc
      expect(back.content!.find((n) => n.type === 'table')!.attrs!.tableStyle).toBe(style)
      expect(() => importOdt(exportOdt(json).data)).not.toThrow()
    }
  })
})

describe('style operations', () => {
  it('updates a style from the selection and clears the direct formatting', async () => {
    const { updateStyleFromSelection } = await import('@/editor/style-ops')
    const { defaultStyles } = await import('@/editor/model')
    const e = new Editor({
      extensions: createExtensions(),
      content: { type: 'doc', attrs: { styles: defaultStyles() }, content: [{ type: 'paragraph', attrs: { styleId: 'Quote', align: 'center', spaceAfter: 20 }, content: [{ type: 'text', text: 'Quoted', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '14pt' } }] }] }] }
    })
    e.commands.setTextSelection(2)
    expect(updateStyleFromSelection(e)).toBe('Quote')
    const q = (e.state.doc.attrs.styles as Record<string, { para: Record<string, unknown>; run: Record<string, unknown> }>).Quote
    expect(q.para).toMatchObject({ align: 'center', spaceAfter: 20 })
    expect(q.run).toMatchObject({ color: '#ff0000', fontSize: 14 })
    const p = e.state.doc.firstChild!
    expect(p.attrs.align).toBeNull()
    expect(p.firstChild!.marks).toEqual([])
  })
})
