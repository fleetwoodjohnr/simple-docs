// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { createExtensions } from '@/editor/extensions'
import { insertMergeField, mergeDocuments, mergeFieldsIn, parseCsv, setMergePreview } from '@/editor/mailmerge'
import { exportDocx } from '@/formats/docx/write'
import { importDocx } from '@/formats/docx/read'

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, embedded newlines, CRLF, BOM and blank lines', () => {
    const r = parseCsv('﻿Name,City,Note\r\n"Lovelace, Ada",London,"said ""hi""\nthen left"\r\n\r\nTuring,Wilmslow,\r\n')
    expect(r.fields).toEqual(['Name', 'City', 'Note'])
    expect(r.rows).toEqual([
      { Name: 'Lovelace, Ada', City: 'London', Note: 'said "hi"\nthen left' },
      { Name: 'Turing', City: 'Wilmslow', Note: '' }
    ])
  })
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([{ a: '1', b: '2' }])
    expect(parseCsv('a\tb\n1\t2').rows).toEqual([{ a: '1', b: '2' }])
  })
})

describe('merge', () => {
  const field = (name: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'mergeField', attrs: { name }, ...(marks ? { marks } : {}) })
  const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dear ' }, field('Name', [{ type: 'bold' }]), { type: 'text', text: ', welcome to ' }, field('City'), { type: 'text', text: '.' }] }] }

  it('makes one copy per record with page breaks and keeps field formatting', () => {
    const out = mergeDocuments(doc, [{ Name: 'Ada', City: 'London' }, { Name: 'Alan', City: '' }])
    const e = new Editor({ extensions: createExtensions(), content: out })
    expect(e.state.doc.content.content.map((n) => n.type.name + ':' + n.textContent)).toEqual(['paragraph:Dear Ada, welcome to London.', 'pageBreak:', 'paragraph:Dear Alan, welcome to .'])
    expect(out.content![0].content![1]).toEqual({ type: 'text', text: 'Ada', marks: [{ type: 'bold' }] })
    expect(mergeFieldsIn(doc)).toEqual(['Name', 'City'])
  })

  it('previews a record without changing the document, and round-trips fields through DOCX as MERGEFIELD', () => {
    const e = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }] }] } })
    e.commands.setTextSelection(4)
    insertMergeField(e, 'First Name')
    const before = e.getJSON()
    setMergePreview(e, { 'First Name': 'Grace' })
    expect(e.view.dom.textContent).toContain('Hi Grace')
    expect(e.getJSON()).toEqual(before)
    setMergePreview(e, null)
    expect(e.view.dom.textContent).toContain('Hi «First Name»')
    const bytes = exportDocx(e.getJSON()).data
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('w:instr=" MERGEFIELD &quot;First Name&quot; \\* MERGEFORMAT "')
    expect(importDocx(bytes).doc.content![0].content).toEqual([{ type: 'text', text: 'Hi ' }, { type: 'mergeField', attrs: { name: 'First Name' } }])
  })
})
