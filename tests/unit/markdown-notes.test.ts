// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

describe('GFM footnotes', () => {
  it('imports references and multi-line definitions as notes, leaving code alone', async () => {
    const { importMarkdown } = await import('@/formats/markdown')
    const src = 'Claim[^a] and another[^b].\n\n```\nnot[^a] a ref\n```\n\n[^a]: First note.\n[^b]: Second note,\n    continued.\n'
    const doc = importMarkdown(new TextEncoder().encode(src)).doc
    const notes: string[] = []
    const walk = (n: import('@tiptap/core').JSONContent) => {
      if (n.type === 'footnote') notes.push(JSON.stringify(n.attrs?.content))
      n.content?.forEach(walk)
    }
    walk(doc)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('First note.')
    expect(notes[1]).toContain('continued.')
    expect(JSON.stringify(doc)).toContain('not[^a] a ref')
    expect(JSON.stringify(doc)).not.toContain('[^b]')
  })
})
