import type { CitationStyle, Source, SourceMap, SourceType } from '@/editor/citations'

// Word's bibliography store: a customXml part with <b:Sources>, referenced by CITATION fields.

export const BIB_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography'
const TYPES: Record<SourceType, string> = { book: 'Book', article: 'JournalArticle', website: 'InternetSite', report: 'Report' }
const STYLE_FILES: Record<CitationStyle, string> = { apa: '\\APASixthEditionOfficeOnline.xsl', mla: '\\MLASeventhEditionOfficeOnline.xsl', chicago: '\\CHICAGO.XSL' }

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const el = (tag: string, v?: string) => (v ? `<b:${tag}>${x(v)}</b:${tag}>` : '')

function authorXml(authors: string[]): string {
  const list = authors.filter((a) => a.trim())
  if (!list.length) return ''
  const corp = list.length === 1 && !list[0].includes(',')
  if (corp) return `<b:Author><b:Author><b:Corporate>${x(list[0])}</b:Corporate></b:Author></b:Author>`
  const people = list
    .map((a) => {
      const [last, first = ''] = a.split(',').map((p) => p.trim())
      const [given, ...middle] = first.split(/\s+/).filter(Boolean)
      return `<b:Person><b:Last>${x(last)}</b:Last>${el('First', given)}${el('Middle', middle.join(' '))}</b:Person>`
    })
    .join('')
  return `<b:Author><b:Author><b:NameList>${people}</b:NameList></b:Author></b:Author>`
}

export function sourcesXml(sources: SourceMap, style: CitationStyle): string {
  const items = Object.entries(sources)
    .map(([tag, s], i) => {
      const container = s.type === 'article' ? el('JournalName', s.container) : s.type === 'website' ? el('InternetSiteTitle', s.container) : ''
      return `<b:Source><b:Tag>${x(tag)}</b:Tag><b:SourceType>${TYPES[s.type]}</b:SourceType><b:RefOrder>${i + 1}</b:RefOrder>${authorXml(s.authors)}${el('Title', s.title)}${el('Year', s.year)}${container}${el('Publisher', s.publisher)}${el('Volume', s.volume)}${el('Issue', s.issue)}${el('Pages', s.pages)}${el('URL', s.url)}${el('DOI', s.doi)}</b:Source>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<b:Sources SelectedStyle="${x(STYLE_FILES[style])}" xmlns:b="${BIB_NS}" xmlns="${BIB_NS}">${items}</b:Sources>`
}

export const itemPropsXml = (guid: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="${guid}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${BIB_NS}"/></ds:schemaRefs></ds:datastoreItem>`

/** Parse a <b:Sources> document (any namespace prefix). */
export function parseSources(doc: Document): { sources: SourceMap; style: CitationStyle } | null {
  const root = doc.documentElement
  if (!root || root.localName !== 'Sources' || root.namespaceURI !== BIB_NS) return null
  const kids = (e: Element, name: string) => Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === name)
  const one = (e: Element | undefined, name: string) => (e ? kids(e, name)[0] : undefined)
  const txt = (e: Element | undefined, name: string) => one(e, name)?.textContent?.trim() || undefined
  const sources: SourceMap = {}
  for (const s of kids(root, 'Source')) {
    const tag = txt(s, 'Tag')
    if (!tag) continue
    const typeName = txt(s, 'SourceType') ?? 'Book'
    const type = (Object.entries(TYPES).find(([, v]) => v === typeName)?.[0] ?? (/Article/.test(typeName) ? 'article' : /Internet|Web/.test(typeName) ? 'website' : 'book')) as SourceType
    const author = one(one(s, 'Author'), 'Author')
    const corp = txt(author, 'Corporate')
    const people = one(author, 'NameList') ? kids(one(author, 'NameList')!, 'Person') : []
    const authors = corp ? [corp] : people.map((p) => [txt(p, 'Last'), [txt(p, 'First'), txt(p, 'Middle')].filter(Boolean).join(' ')].filter(Boolean).join(', '))
    sources[tag] = Object.fromEntries(
      Object.entries({
        type,
        authors,
        title: txt(s, 'Title') ?? '',
        year: txt(s, 'Year'),
        container: txt(s, 'JournalName') ?? txt(s, 'InternetSiteTitle') ?? txt(s, 'PeriodicalTitle'),
        publisher: txt(s, 'Publisher'),
        volume: txt(s, 'Volume'),
        issue: txt(s, 'Issue'),
        pages: txt(s, 'Pages'),
        url: txt(s, 'URL'),
        doi: txt(s, 'DOI')
      }).filter(([, v]) => v !== undefined)
    ) as unknown as Source
  }
  const sel = root.getAttribute('SelectedStyle') ?? ''
  const style: CitationStyle = /MLA/i.test(sel) ? 'mla' : /CHICAGO/i.test(sel) ? 'chicago' : 'apa'
  return { sources, style }
}
