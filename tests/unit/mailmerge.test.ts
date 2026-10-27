// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { createExtensions } from '@/editor/extensions'
import { insertMergeField, mergeDocuments, mergeFieldsIn, parseCsv, setMergePreview, toCsv } from '@/editor/mailmerge'
import { exportBytes } from '@/formats/registry'
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

describe('recipient list saved with the document', () => {
  const data = {
    name: 'people.csv',
    fields: ['Name', 'City; region', 'Note'],
    rows: [
      { Name: 'Lovelace, Ada', 'City; region': 'London', Note: 'said "hi"\r\nthen left' },
      { Name: ' Turing ', 'City; region': '', Note: '<b>&amp;</b>' }
    ]
  }

  it('toCsv is the inverse of parseCsv (quotes, delimiters, newlines, spaces)', () => {
    expect(parseCsv(toCsv(data))).toEqual({ fields: data.fields, rows: data.rows })
  })

  it('travels in DOCX as a custom XML part; other formats warn that it is not kept', async () => {
    const doc: JSONContent = { type: 'doc', attrs: { mergeData: data }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dear ' }, { type: 'mergeField', attrs: { name: 'Name' } }] }] }
    const out = exportDocx(doc)
    const files = unzipSync(out.data)
    const part = Object.keys(files).find((p) => /^customXml\/item\d+\.xml$/.test(p) && strFromU8(files[p]).includes('urn:simple-docs:mail-merge:1'))!
    expect(part).toBeTruthy()
    expect(strFromU8(files['[Content_Types].xml'])).toContain(part.replace('item', 'itemProps'))
    expect(importDocx(out.data).doc.attrs?.mergeData).toEqual(data)
    expect(out.warnings.map((w) => w.message).join()).not.toMatch(/recipient/)
    const lo = { available: async () => false, convert: async () => new Uint8Array() }
    for (const fmt of ['odt', 'md', 'html', 'txt'] as const) expect((await exportBytes(fmt, doc, null, lo)).warnings.map((w) => w.message)).toContain('The mail-merge recipient list isn’t saved in this format (DOCX keeps it)')
    expect(mergeDocuments(doc, data.rows).attrs?.mergeData).toBeNull()
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
