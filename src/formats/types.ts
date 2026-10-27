import type { JSONContent } from '@tiptap/core'

export type FormatId = 'docx' | 'odt' | 'rtf' | 'doc' | 'md' | 'html' | 'txt'

export interface FormatWarning {
  /** 'loss' = content or formatting will not survive; 'info' = notable but harmless. */
  level: 'info' | 'loss'
  message: string
  count?: number
}

export interface ImportResult {
  doc: JSONContent
  warnings: FormatWarning[]
  /** Adapter-specific data kept with the tab and handed back on export (e.g. original DOCX parts). */
  carry?: unknown
}

export interface ExportResult {
  data: Uint8Array
  warnings: FormatWarning[]
}

/** Collects warnings, merging repeats into a count. */
export class Warnings {
  private map = new Map<string, FormatWarning>()
  add(level: FormatWarning['level'], message: string) {
    const w = this.map.get(message)
    if (w) w.count = (w.count ?? 1) + 1
    else this.map.set(message, { level, message })
  }
  list(): FormatWarning[] {
    return [...this.map.values()]
  }
}

export const FORMAT_LABELS: Record<FormatId, string> = {
  docx: 'Word Document',
  odt: 'OpenDocument Text',
  rtf: 'Rich Text Format',
  doc: 'Word 97–2003 Document',
  md: 'Markdown',
  html: 'Web Page',
  txt: 'Plain Text'
}

export function formatFromPath(path: string): FormatId | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'markdown') return 'md'
  if (ext === 'htm') return 'html'
  return (['docx', 'odt', 'rtf', 'doc', 'md', 'html', 'txt'] as const).find((f) => f === ext) ?? null
}
