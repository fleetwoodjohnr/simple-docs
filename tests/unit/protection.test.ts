// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { type Editor } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { createExtensions } from '@/editor/extensions'
import { setProtection, setProtectionNotice } from '@/editor/protection'
import { addComment } from '@/editor/comments'
import { listChanges, resolveChanges, setTracking } from '@/editor/track'
import { exportDocx } from '@/formats/docx/write'
import { importDocx } from '@/formats/docx/read'
import { testEditor } from './editor'

const make = () => testEditor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }] } })
const text = (e: Editor) => e.state.doc.textContent

describe('restrict editing', () => {
  it('read only blocks every change and makes the editor non-editable', () => {
    const e = make()
    const blocked: string[] = []
    setProtectionNotice((m) => blocked.push(m))
    setProtection(e, 'readOnly')
    expect(e.isEditable).toBe(false)
    e.commands.insertContentAt(1, 'X')
    e.commands.setTextSelection({ from: 1, to: 6 })
    expect(addComment(e, 'me')).not.toBeNull() // the call runs, but the transaction is refused
    expect(text(e)).toBe('Hello world')
    expect(e.state.doc.attrs.comments).toBeNull()
    expect(blocked).toContain('readOnly')
    setProtection(e, null)
    e.commands.insertContentAt(1, 'X')
    expect(text(e)).toBe('XHello world')
  })

  it('comments only allows comments and nothing else', () => {
    const e = make()
    setProtection(e, 'comments')
    e.commands.insertContentAt(1, 'X')
    expect(text(e)).toBe('Hello world')
    e.commands.setTextSelection({ from: 1, to: 6 })
    const id = addComment(e, 'me')!
    expect(Object.keys(e.state.doc.attrs.comments)).toEqual([id])
  })

  it('tracked changes only forces tracking, which cannot be turned off, and blocks accept/reject', () => {
    const e = make()
    setProtection(e, 'tracked')
    expect(e.state.doc.attrs.trackChanges).toBe(true)
    e.commands.insertContentAt(1, 'New ')
    expect(listChanges(e.state.doc).map((c) => c.kind)).toEqual(['insertion'])
    setTracking(e, false)
    expect(e.state.doc.attrs.trackChanges).toBe(true)
    resolveChanges(e, true)
    expect(listChanges(e.state.doc)).toHaveLength(1)
  })

  it('round-trips through DOCX as an enforced w:documentProtection', () => {
    for (const [mode, edit] of [['readOnly', 'readOnly'], ['comments', 'comments'], ['tracked', 'trackedChanges']] as const) {
      const e = make()
      setProtection(e, mode)
      const bytes = exportDocx(e.getJSON()).data
      expect(strFromU8(unzipSync(bytes)['word/settings.xml'])).toContain(`<w:documentProtection w:edit="${edit}" w:enforcement="1"/>`)
      expect(importDocx(bytes).doc.attrs!.protection).toBe(mode)
    }
    const e = make()
    expect(importDocx(exportDocx(e.getJSON()).data).doc.attrs!.protection).toBeNull()
  })
})
