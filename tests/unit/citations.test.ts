// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { createExtensions } from '@/editor/extensions'
import { formatCitation, formatEntry, insertBibliography, insertCitation, makeTag, saveSource, setCitationStyle, type Source } from '@/editor/citations'
import { exportDocx } from '@/formats/docx/write'
import { importDocx } from '@/formats/docx/read'
import { exportMarkdown } from '@/formats/markdown'

const book: Source = { type: 'book', authors: ['Lovelace, Ada Augusta'], title: 'Notes on the Analytical Engine', year: '1843', publisher: 'Taylor' }
const article: Source = { type: 'article', authors: ['Turing, Alan Mathison', 'Hopper, Grace'], title: 'Computing machinery and intelligence', year: '1950', container: 'Mind', volume: '59', issue: '236', pages: '433–460', doi: '10.1093/mind/LIX.236.433' }
const web: Source = { type: 'website', authors: ['World Health Organization'], title: 'Hand hygiene', year: '2024', container: 'WHO', url: 'https://www.who.int/hand' }
const three: Source = { ...book, authors: ['Doe, Jane', 'Roe, Richard', 'Poe, Edgar Allan'] }
const plain = (c: JSONContent[]) => c.map((n) => (n.marks ? `*${n.text}*` : n.text)).join('')

describe('citation formatting', () => {
  it('in-text citations follow APA, MLA and Chicago', () => {
    expect(formatCitation(book, 'apa')).toBe('(Lovelace, 1843)')
    expect(formatCitation(book, 'apa', '12')).toBe('(Lovelace, 1843, p. 12)')
    expect(formatCitation(article, 'apa', '433–435')).toBe('(Turing & Hopper, 1950, pp. 433–435)')
    expect(formatCitation(three, 'apa')).toBe('(Doe et al., 1843)')
    expect(formatCitation(book, 'mla', '12')).toBe('(Lovelace 12)')
    expect(formatCitation(article, 'mla')).toBe('(Turing and Hopper)')
    expect(formatCitation(book, 'chicago', '12')).toBe('(Lovelace 1843, 12)')
    expect(formatCitation(three, 'chicago')).toBe('(Doe, Roe, and Poe 1843)')
    expect(formatCitation({ ...book, year: undefined }, 'apa')).toBe('(Lovelace, n.d.)')
  })

  it('reference entries follow each style', () => {
    expect(plain(formatEntry(book, 'apa'))).toBe('Lovelace, A. A. (1843). *Notes on the Analytical Engine*. Taylor.')
    expect(plain(formatEntry(article, 'apa'))).toBe('Turing, A. M., & Hopper, G. (1950). Computing machinery and intelligence. *Mind*, *59*(236), 433–460. https://doi.org/10.1093/mind/LIX.236.433')
    expect(plain(formatEntry(web, 'apa'))).toBe('World Health Organization. (2024). *Hand hygiene*. WHO. https://www.who.int/hand')
    expect(plain(formatEntry(book, 'mla'))).toBe('Lovelace, Ada Augusta. *Notes on the Analytical Engine*. Taylor, 1843.')
    expect(plain(formatEntry(article, 'mla'))).toBe('Turing, Alan Mathison, and Grace Hopper. “Computing machinery and intelligence.” *Mind*, vol. 59, no. 236, 1950, pp. 433–460. https://doi.org/10.1093/mind/LIX.236.433.')
    expect(plain(formatEntry(three, 'mla'))).toBe('Doe, Jane, et al. *Notes on the Analytical Engine*. Taylor, 1843.')
    expect(plain(formatEntry(book, 'chicago'))).toBe('Lovelace, Ada Augusta. 1843. *Notes on the Analytical Engine*. Taylor.')
    expect(plain(formatEntry(article, 'chicago'))).toBe('Turing, Alan Mathison, and Grace Hopper. 1950. “Computing machinery and intelligence.” *Mind* 59 (236): 433–460. https://doi.org/10.1093/mind/LIX.236.433.')
  })

  it('tags are short and unique', () => {
    expect(makeTag(book, [])).toBe('Lov43')
    expect(makeTag(book, ['Lov43'])).toBe('Lov431')
  })
})

describe('citations in a document', () => {
  const make = () => new Editor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'As argued ' }] }] } })

  it('inserts citations and a bibliography that follow the style', () => {
    const e = make()
    const id = saveSource(e, book)
    const id2 = saveSource(e, article)
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    insertCitation(e, id, '12')
    insertCitation(e, id2)
    insertBibliography(e)
    expect(e.state.doc.textContent).toContain('As argued (Lovelace, 1843, p. 12)(Turing & Hopper, 1950)')
    expect(e.state.doc.textContent).toContain('References')
    setCitationStyle(e, 'mla')
    expect(e.state.doc.textContent).toContain('(Lovelace 12)(Turing and Hopper)')
    expect(e.state.doc.textContent).toContain('Works Cited')
    expect(e.state.doc.textContent).toContain('Lovelace, Ada Augusta. Notes on the Analytical Engine. Taylor, 1843.')
    // editing a source updates every citation
    saveSource(e, { ...book, authors: ['Byron, Ada'] }, id)
    expect(e.state.doc.textContent).toContain('(Byron 12)')
  })

  it('round-trips through DOCX as CITATION fields and Word bibliography sources', () => {
    const e = make()
    const id = saveSource(e, book)
    saveSource(e, web)
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    insertCitation(e, id, '12')
    setCitationStyle(e, 'chicago')
    const bytes = exportDocx(e.getJSON()).data
    const files = unzipSync(bytes)
    expect(strFromU8(files['word/document.xml'])).toContain(' CITATION Lov43 \\l 1033 \\p &quot;12&quot; ')
    expect(strFromU8(files['customXml/item1.xml'])).toContain('<b:Tag>Lov43</b:Tag><b:SourceType>Book</b:SourceType>')
    expect(strFromU8(files['customXml/item1.xml'])).toContain('<b:Corporate>World Health Organization</b:Corporate>')
    const back = importDocx(bytes).doc
    expect(back.attrs!.citationStyle).toBe('chicago')
    expect(back.attrs!.sources).toEqual(e.state.doc.attrs.sources)
    const cite = back.content![0].content!.find((n) => n.type === 'citation')!
    expect(cite.attrs).toEqual({ source: 'Lov43', pages: '12', text: '(Lovelace 1843, 12)' })
  })

  it('Markdown keeps the citation text', () => {
    const e = make()
    const id = saveSource(e, book)
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    insertCitation(e, id)
    const md = exportMarkdown(e.getJSON())
    expect(new TextDecoder().decode(md.data)).toContain('As argued (Lovelace, 1843)')
    expect(md.warnings.map((w) => w.message)).toContain('Citations are saved as plain text in Markdown')
  })
})
