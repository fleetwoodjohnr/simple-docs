// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { type JSONContent, type Editor } from '@tiptap/core'
import { createExtensions } from '@/editor/extensions'
import { compareDocuments } from '@/editor/compare'
import { listChanges, resolveChanges } from '@/editor/track'
import { testEditor } from './editor'

const rev = { author: 'Compare', date: '2026-10-27T10:00:00.000Z' }
const p = (...parts: (string | JSONContent)[]): JSONContent => ({ type: 'paragraph', content: parts.map((t) => (typeof t === 'string' ? { type: 'text', text: t } : t)) })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const bold = (t: string): JSONContent => ({ type: 'text', text: t, marks: [{ type: 'bold' }] })
const load = (json: JSONContent) => testEditor({ extensions: createExtensions(), content: json })
// (trailing blank lines come from the editor's trailing-paragraph rule)
const text = (e: Editor) => e.state.doc.textBetween(0, e.state.doc.content.size, '\n').replace(/\n+$/, '')

/** Accept-all must give the revised text, reject-all the original. */
function roundTrip(a: JSONContent, b: JSONContent) {
  const r = compareDocuments(a, b, rev)
  const acc = load(r.doc)
  resolveChanges(acc, true)
  const rej = load(r.doc)
  resolveChanges(rej, false)
  return { r, accepted: text(acc), rejected: text(rej), changes: listChanges(load(r.doc).state.doc) }
}

describe('compare documents', () => {
  it('identical documents produce no changes', () => {
    const a = doc(p('Hello ', bold('world')), p('Second.'))
    const { r, changes } = roundTrip(a, structuredClone(a))
    expect(changes).toEqual([])
    expect(r.insertions + r.deletions).toBe(0)
  })

  it('marks word-level edits inside a paragraph and keeps formatting', () => {
    const a = doc(p('The quick brown fox jumps.'))
    const b = doc(p('The quick ', bold('red'), ' fox leaps.'))
    const { r, accepted, rejected, changes } = roundTrip(a, b)
    expect(accepted).toBe('The quick red fox leaps.')
    expect(rejected).toBe('The quick brown fox jumps.')
    expect(changes.map((c) => c.kind)).toEqual(['deletion', 'insertion', 'deletion', 'insertion'])
    expect(r.doc.content![0].content!.find((n) => n.text === 'red')!.marks!.map((m) => m.type)).toEqual(['bold', 'insertion'])
  })

  it('handles inserted, deleted and moved paragraphs', () => {
    const a = doc(p('One.'), p('Two.'), p('Three.'))
    const b = doc(p('One.'), p('Three.'), p('Four.'))
    const { accepted, rejected } = roundTrip(a, b)
    expect(accepted).toBe('One.\nThree.\nFour.')
    expect(rejected).toBe('One.\nTwo.\nThree.')
  })

  it('compares table cells in place and list items recursively', () => {
    const cell = (t: string): JSONContent => ({ type: 'tableCell', content: [p(t)] })
    const table = (rows: string[][]): JSONContent => ({ type: 'table', content: rows.map((r) => ({ type: 'tableRow', content: r.map(cell) })) })
    const list = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) })
    const a = doc(table([['Item', 'Qty'], ['Apples', '4']]), list('alpha', 'beta'))
    const b = doc(table([['Item', 'Qty'], ['Apples', '5']]), list('alpha', 'beta', 'gamma'))
    const { r, accepted, rejected } = roundTrip(a, b)
    expect(accepted).toBe('Item\nQty\nApples\n5\nalpha\nbeta\ngamma')
    expect(rejected).toBe('Item\nQty\nApples\n4\nalpha\nbeta')
    // the table keeps its 2×2 shape
    expect(r.doc.content![0].content!.map((row) => row.content!.length)).toEqual([2, 2])
  })

  it('compares the final text of documents that already contain tracked changes', () => {
    const a = doc(p('Keep ', { type: 'text', text: 'gone', marks: [{ type: 'deletion', attrs: { author: 'x', date: '' } }] }, 'this'))
    const b = doc(p('Keep this'))
    expect(roundTrip(a, b).changes).toEqual([])
  })
})
