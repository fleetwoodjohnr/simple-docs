import type { JSONContent } from '@tiptap/core'
import { formatNumber, effectiveListType } from '@/editor/numbering'
import type { ExportResult, ImportResult } from './types'

/** Decode text with BOM detection; falls back to Windows-1252 for invalid UTF-8. */
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder('utf-8').decode(data.subarray(3))
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

export function importText(data: Uint8Array): ImportResult {
  const content: JSONContent[] = []
  for (const page of decodeText(data).replace(/\r\n?/g, '\n').split('\f')) {
    if (content.length) content.push({ type: 'pageBreak' })
    for (const line of page.split('\n')) content.push(line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })
  }
  if (content.length > 1 && content[content.length - 1].type === 'paragraph' && !content[content.length - 1].content) content.pop()
  return { doc: { type: 'doc', content }, warnings: [] }
}

let notes: JSONContent[][] = []

function inlineText(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'footnote') {
        notes.push((n.attrs?.content as JSONContent[]) ?? [])
        return `[${notes.length}]`
      }
      if (n.marks?.some((m) => m.type === 'deletion')) return ''
      return n.type === 'text' ? n.text : n.type === 'hardBreak' ? '\n' : n.type === 'preservedInline' ? n.attrs?.text ?? '' : ''
    })
    .join('')
}

export function docToText(doc: JSONContent): string {
  const lines: string[] = []
  const walk = (nodes: JSONContent[] = [], indent: string, depth: number) => {
    for (const n of nodes) {
      const a = n.attrs ?? {}
      switch (n.type) {
        case 'paragraph':
        case 'heading':
          lines.push(indent + inlineText(n.content))
          break
        case 'codeBlock':
          lines.push(...inlineText(n.content).split('\n').map((l) => indent + l))
          break
        case 'bulletList':
        case 'orderedList':
        case 'taskList': {
          const type = effectiveListType(a.type, depth)
          ;(n.content ?? []).forEach((item, i) => {
            const marker =
              n.type === 'orderedList' ? `${formatNumber((Number(a.start) || 1) + i, type === '1.1' ? '1' : type)}.` : n.type === 'taskList' ? (item.attrs?.checked ? '[x]' : '[ ]') : '•'
            const start = lines.length
            walk(item.content, indent + '    ', depth + 1)
            if (lines[start] !== undefined) lines[start] = indent + marker + ' ' + lines[start].slice(indent.length + 4)
          })
          break
        }
        case 'table':
          for (const row of n.content ?? []) lines.push(indent + (row.content ?? []).map((c) => (c.content ?? []).map((b) => inlineText(b.content)).join(' ')).join('\t'))
          break
        case 'pageBreak':
        case 'sectionBreak':
          lines.push('\f')
          break
        case 'horizontalRule':
          lines.push(indent + '———')
          break
        case 'preservedBlock':
          lines.push(indent + String(a.text ?? ''))
          break
        default:
          walk(n.content, indent, depth)
      }
    }
  }
  notes = []
  walk(doc.content, '', 0)
  const collected = notes
  notes = []
  if (collected.length) {
    lines.push('', '———')
    collected.forEach((c, i) => lines.push(`[${i + 1}] ${c.map((b) => inlineText(b.content)).join(' ')}`))
  }
  return lines.join('\n').replace(/\n?\f\n?/g, '\f') + '\n'
}

export function exportText(doc: JSONContent): ExportResult {
  const hasFormatting = JSON.stringify(doc.content ?? []).includes('"marks"')
  return {
    data: new TextEncoder().encode(docToText(doc)),
    warnings: hasFormatting ? [{ level: 'loss', message: 'All formatting, images and tables are reduced to plain text' }] : []
  }
}
