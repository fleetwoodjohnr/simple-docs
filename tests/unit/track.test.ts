// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { type Editor } from '@tiptap/core'
import { createExtensions } from '@/editor/extensions'
import { listChanges, resolveChanges, setTrackAuthor } from '@/editor/track'
import { testEditor } from './editor'

setTrackAuthor(() => 'Alice')

function make(text = 'The quick brown fox') {
  return testEditor({ extensions: createExtensions(), content: { type: 'doc', attrs: { trackChanges: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
}
const marked = (e: Editor, name: string) => {
  const out: string[] = []
  e.state.doc.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === name)) out.push(n.text!)
  })
  return out.join('|')
}

describe('track changes', () => {
  it('marks typed text as an insertion by the current author', () => {
    const e = make()
    e.chain().setTextSelection(20).insertContent(' jumps').run()
    expect(e.getText()).toBe('The quick brown fox jumps')
    expect(marked(e, 'insertion')).toBe(' jumps')
    expect(listChanges(e.state.doc)[0]).toMatchObject({ kind: 'insertion', author: 'Alice' })
  })

  it('keeps deleted text, struck through', () => {
    const e = make()
    e.chain().deleteRange({ from: 5, to: 11 }).run() // "quick "
    expect(e.getText()).toBe('The quick brown fox')
    expect(marked(e, 'deletion')).toBe('quick ')
  })

  it('really deletes your own pending insertion', () => {
    const e = make()
    e.chain().setTextSelection(20).insertContent(' jumps').run()
    e.chain().deleteRange({ from: 20, to: 26 }).run()
    expect(e.getText()).toBe('The quick brown fox')
    expect(listChanges(e.state.doc)).toEqual([])
  })

  it('typing over a selection records a deletion and an insertion', () => {
    const e = make()
    e.chain().setTextSelection({ from: 11, to: 16 }).insertContent('red').run() // brown → red
    expect(marked(e, 'deletion')).toBe('brown')
    expect(marked(e, 'insertion')).toBe('red')
  })

  it('accept all applies the changes; reject all restores the original', () => {
    const a = make()
    a.chain().setTextSelection({ from: 11, to: 16 }).insertContent('red').run()
    resolveChanges(a, true)
    expect(a.getText()).toBe('The quick red fox')
    expect(listChanges(a.state.doc)).toEqual([])

    const r = make()
    r.chain().setTextSelection({ from: 11, to: 16 }).insertContent('red').run()
    resolveChanges(r, false)
    expect(r.getText()).toBe('The quick brown fox')
    expect(listChanges(r.state.doc)).toEqual([])
  })

  it('one undo reverts a tracked edit', () => {
    const e = make()
    e.chain().deleteRange({ from: 5, to: 11 }).run()
    e.commands.undo()
    expect(e.getText()).toBe('The quick brown fox')
    expect(listChanges(e.state.doc)).toEqual([])
  })

  it('does nothing while tracking is off', () => {
    const e = testEditor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }] } })
    e.chain().deleteRange({ from: 1, to: 2 }).run()
    expect(e.getText()).toBe('bc')
  })
})
