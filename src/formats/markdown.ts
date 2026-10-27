import MarkdownIt from 'markdown-it'
import type { JSONContent } from '@tiptap/core'
import { htmlToDoc } from './html'
import { Warnings, type ExportResult, type ImportResult } from './types'

// ---------- import: CommonMark + GFM (tables, strikethrough, task lists) ----------

const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

/** Turn GFM task-list items into the editor's taskList markup. */
function taskLists(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI')
    const re = /^\s*\[( |x|X)\]\s?/
    const firstText = (li: Element) => {
      const p = li.firstElementChild?.tagName === 'P' ? li.firstElementChild : li
      return p.firstChild?.nodeType === 3 ? (p.firstChild as Text) : null
    }
    if (!items.length || !items.every((li) => re.test(firstText(li)?.data ?? ''))) return
    ul.setAttribute('data-type', 'taskList')
    for (const li of items) {
      const t = firstText(li)!
      const checked = /x/i.test(re.exec(t.data)![1])
      t.data = t.data.replace(re, '')
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', String(checked))
      if (li.firstElementChild?.tagName !== 'P') {
        const p = doc.createElement('p')
        while (li.firstChild && !(li.firstChild instanceof Element && /^(UL|OL)$/.test(li.firstChild.tagName))) p.appendChild(li.firstChild)
        li.insertBefore(p, li.firstChild)
      }
    }
  })
  return doc.body.innerHTML
}

export function markdownToDoc(text: string): JSONContent {
  return htmlToDoc(taskLists(md.render(text)))
}

export function importMarkdown(data: Uint8Array): ImportResult {
  const text = new TextDecoder('utf-8').decode(data)
  const w = new Warnings()
  if (/<[a-z][^>]*>/i.test(text)) w.add('info', 'Raw HTML in the Markdown source is shown as text')
  return { doc: markdownToDoc(text), warnings: w.list() }
}

// ---------- export: editor JSON → GFM ----------

type Mk = { open: string; close: string; code?: boolean }

const SUPPORTED_MARKS = ['link', 'bold', 'italic', 'strike', 'code']
const MARK_NAMES: Record<string, string> = {
  underline: 'Underline',
  subscript: 'Subscript',
  superscript: 'Superscript',
  highlight: 'Highlight',
  textStyle: 'Fonts, sizes and colors',
  doubleStrike: 'Double strikethrough',
  comment: 'Comments'
}

function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]<>~|])/g, '\\$1')
}

function markFor(m: { type: string; attrs?: Record<string, unknown> }): Mk {
  switch (m.type) {
    case 'bold':
      return { open: '**', close: '**' }
    case 'italic':
      return { open: '*', close: '*' }
    case 'strike':
      return { open: '~~', close: '~~' }
    case 'code':
      return { open: '`', close: '`', code: true }
    case 'link': {
      const href = String(m.attrs?.href ?? '').replace(/[()\s]/g, encodeURIComponent)
      return { open: '[', close: `](${href})` }
    }
    default:
      return { open: '', close: '' }
  }
}

class Serializer {
  w = new Warnings()
  notes: JSONContent[][] = []

  inline(nodes: JSONContent[] = []): string {
    let out = ''
    let stack: string[] = [] // mark keys currently open
    const key = (m: { type: string; attrs?: Record<string, unknown> }) => m.type + (m.type === 'link' ? String(m.attrs?.href) : '')
    let pendingTrail = ''
    const closeTo = (n: number) => {
      while (stack.length > n) {
        const k = stack.pop()!
        out += openMarks.get(k)!.close
      }
    }
    const openMarks = new Map<string, Mk>()
    for (const node of nodes) {
      if (node.marks?.some((m) => m.type === 'deletion' || m.type === 'insertion')) this.w.add('info', 'Tracked changes are exported as the final text')
      if (node.marks?.some((m) => m.type === 'deletion')) continue
      const marks = (node.marks ?? []).filter((m) => {
        if (m.type === 'insertion' || m.type === 'comment') return false
        if (SUPPORTED_MARKS.includes(m.type)) return true
        this.w.add('loss', `${MARK_NAMES[m.type] ?? m.type} cannot be represented in Markdown`)
        return false
      })
      marks.sort((a, b) => SUPPORTED_MARKS.indexOf(a.type) - SUPPORTED_MARKS.indexOf(b.type))
      const keys = marks.map(key)
      let keep = 0
      while (keep < stack.length && keep < keys.length && stack[keep] === keys[keep]) keep++
      closeTo(keep)
      out += pendingTrail
      pendingTrail = ''
      if (node.type === 'text') {
        const raw = node.text ?? ''
        const isCode = marks.some((m) => m.type === 'code')
        const lead = /^\s*/.exec(raw)![0]
        const trail = raw.length > lead.length ? /\s*$/.exec(raw)![0] : ''
        const core = raw.slice(lead.length, raw.length - trail.length)
        out += lead
        for (let i = keep; i < marks.length; i++) {
          const mk = markFor(marks[i])
          openMarks.set(keys[i], mk)
          stack.push(keys[i])
          out += mk.open
        }
        out += isCode ? core : escapeText(core).replace(/\t/g, '    ')
        pendingTrail = trail
      } else {
        closeTo(0)
        if (node.type === 'hardBreak') out += '\\\n'
        else if (node.type === 'image') {
          const a = node.attrs ?? {}
          if (a.width || a.float) this.w.add('loss', 'Image sizes and text wrapping are not kept in Markdown')
          out += `![${escapeText(String(a.alt ?? ''))}](${String(a.src ?? '').replace(/[()\s]/g, encodeURIComponent)}${a.title ? ` "${String(a.title).replace(/"/g, '\\"')}"` : ''})`
        } else if (node.type === 'footnote') {
          const n = this.notes.length + 1
          this.notes.push(node.attrs?.content as JSONContent[])
          out += `[^${n}]`
        } else if (node.type === 'citation') {
          this.w.add('loss', 'Citations are saved as plain text in Markdown')
          out += escapeText(String(node.attrs?.text ?? ''))
        } else if (node.type === 'preservedInline') {
          this.w.add('loss', 'Preserved content from the original file cannot be represented in Markdown')
          out += escapeText(String(node.attrs?.text ?? ''))
        }
      }
    }
    closeTo(0)
    return out + pendingTrail
  }

  paraAttrs(a: Record<string, unknown> = {}) {
    if (a.align || a.lineHeight || a.spaceBefore != null || a.spaceAfter != null || a.indentLeft != null || a.indentFirst != null || a.shading)
      this.w.add('loss', 'Paragraph alignment, spacing, indents and shading are not kept in Markdown')
    if (a.styleId && !['Title', 'Normal'].includes(String(a.styleId))) this.w.add('loss', 'Paragraph styles (Subtitle, Quote, Caption, custom styles) become plain paragraphs')
  }

  blocks(nodes: JSONContent[] = [], tight = false): string {
    return nodes
      .map((n) => this.block(n))
      .filter((s) => s !== null)
      .join(tight ? '\n' : '\n\n')
  }

  listItems(items: JSONContent[] = [], marker: (i: number, item: JSONContent) => string): string {
    return items
      .map((item, i) => {
        const m = marker(i, item)
        const body = this.blocks(item.content, false)
        const pad = ' '.repeat(m.length)
        return m + body.split('\n').map((l, j) => (j === 0 || !l ? l : pad + l)).join('\n')
      })
      .join('\n')
  }

  block(n: JSONContent): string | null {
    const a = n.attrs ?? {}
    switch (n.type) {
      case 'paragraph': {
        this.paraAttrs(a)
        const text = this.inline(n.content).replace(/^(\s*)([#>+-]|\d+[.)])/, '$1\\$2')
        if (a.styleId === 'Title') return `# ${text}`
        return text
      }
      case 'heading': {
        this.paraAttrs({ ...a, styleId: null })
        const level = Number(a.level) || 1
        if (level > 6) this.w.add('loss', 'Headings 7–9 become level 6 in Markdown')
        return `${'#'.repeat(Math.min(6, level))} ${this.inline(n.content)}`
      }
      case 'bulletList':
        return this.listItems(n.content, () => '- ')
      case 'orderedList': {
        const start = Number(a.start) || 1
        if (a.type && a.type !== '1') this.w.add('loss', 'Letter and Roman list numbering become numbers in Markdown')
        return this.listItems(n.content, (i) => `${start + i}. `)
      }
      case 'taskList':
        return this.listItems(n.content, (_i, item) => `- [${item.attrs?.checked ? 'x' : ' '}] `)
      case 'blockquote':
        return this.blocks(n.content)
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n')
      case 'codeBlock': {
        const text = (n.content ?? []).map((c) => c.text ?? '').join('')
        const fence = text.includes('```') ? '~~~~' : '```'
        return `${fence}${a.language ?? ''}\n${text}\n${fence}`
      }
      case 'horizontalRule':
        return '---'
      case 'pageBreak':
      case 'sectionBreak':
        this.w.add('loss', 'Page and section breaks cannot be represented in Markdown')
        return null
      case 'table':
        return this.table(n)
      case 'preservedBlock':
        this.w.add('loss', 'Preserved content from the original file cannot be represented in Markdown')
        return escapeText(String(a.text || a.label))
      default:
        return n.content ? this.blocks(n.content) : null
    }
  }

  table(n: JSONContent): string {
    const rows = (n.content ?? []).map((row) =>
      (row.content ?? []).map((cell) => {
        const ca = cell.attrs ?? {}
        if ((ca.colspan ?? 1) > 1 || (ca.rowspan ?? 1) > 1) this.w.add('loss', 'Merged table cells are split in Markdown')
        if (ca.background) this.w.add('loss', 'Table cell colors are not kept in Markdown')
        const parts = (cell.content ?? []).map((b) => {
          if (b.type === 'paragraph' || b.type === 'heading') return this.inline(b.content)
          this.w.add('loss', 'Lists and other blocks inside table cells are flattened in Markdown')
          return this.inline(flattenInline(b))
        })
        return parts.join('<br>').replace(/\n/g, ' ') || ' '
      })
    )
    if (!rows.length) return ''
    const width = Math.max(...rows.map((r) => r.length))
    const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? ' ').join(' | ')} |`
    return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
  }
}

function flattenInline(n: JSONContent): JSONContent[] {
  const kids = n.content ?? []
  if (kids.every((c) => !c.content)) return kids
  return kids.flatMap((c, i): JSONContent[] => [...(i ? [{ type: 'text', text: ' ' }] : []), ...flattenInline(c)])
}

export function docToMarkdown(doc: JSONContent): { markdown: string; warnings: ReturnType<Warnings['list']> } {
  const s = new Serializer()
  let markdown = s.blocks(doc.content).replace(/\n{3,}/g, '\n\n').trim() + '\n'
  // GFM footnotes (endnotes are numbered in the same sequence).
  for (let i = 0; i < s.notes.length; i++) {
    const body = s.blocks(s.notes[i] ?? []).split('\n').map((l, j) => (j ? `    ${l}` : l)).join('\n')
    markdown += `${i ? '' : '\n'}[^${i + 1}]: ${body}\n`
  }
  return { markdown, warnings: s.w.list() }
}

export function exportMarkdown(doc: JSONContent): ExportResult {
  const { markdown, warnings } = docToMarkdown(doc)
  return { data: new TextEncoder().encode(markdown), warnings }
}
