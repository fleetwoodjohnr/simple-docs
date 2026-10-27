import type { JSONContent } from '@tiptap/core'
import { importDocx, type DocxCarry } from './docx/read'
import { exportDocx } from './docx/write'
import { exportHtml, importHtml } from './html'
import { exportMarkdown, importMarkdown } from './markdown'
import { exportText, importText } from './text'
import type { ExportResult, FormatId, ImportResult } from './types'

/** Bridge to the optional LibreOffice converter in the main process. */
export interface LibreOfficeBridge {
  available(): Promise<boolean>
  convert(data: Uint8Array, from: string, to: string): Promise<Uint8Array>
}

const VIA_LIBREOFFICE: FormatId[] = ['odt', 'rtf', 'doc']

async function needLibreOffice(lo: LibreOfficeBridge, fmt: FormatId) {
  if (!(await lo.available())) {
    throw new Error(`${fmt.toUpperCase()} files need LibreOffice, which was not found. Install LibreOffice (libreoffice.org) and try again, or use DOCX.`)
  }
}

export async function importBytes(format: FormatId, data: Uint8Array, lo: LibreOfficeBridge): Promise<ImportResult> {
  switch (format) {
    case 'docx':
      return importDocx(data)
    case 'md':
      return importMarkdown(data)
    case 'html':
      return importHtml(data)
    case 'txt':
      return importText(data)
    default: {
      await needLibreOffice(lo, format)
      const docx = await lo.convert(data, format, 'docx')
      const r = importDocx(docx)
      return { ...r, warnings: [{ level: 'info', message: `Converted from ${format.toUpperCase()} with LibreOffice; some formatting may differ` }, ...r.warnings] }
    }
  }
}

export async function exportBytes(format: FormatId, doc: JSONContent, carry: unknown, lo: LibreOfficeBridge): Promise<ExportResult> {
  switch (format) {
    case 'docx':
      return exportDocx(doc, (carry as DocxCarry | undefined) ?? null)
    case 'md':
      return exportMarkdown(doc)
    case 'html':
      return exportHtml(doc)
    case 'txt':
      return exportText(doc)
    default: {
      if (!VIA_LIBREOFFICE.includes(format)) throw new Error(`Cannot save as ${format}`)
      if (format === 'doc') throw new Error('Saving in the legacy .doc format is not supported. Save as DOCX instead.')
      await needLibreOffice(lo, format)
      const docx = exportDocx(doc, (carry as DocxCarry | undefined) ?? null)
      return { data: await lo.convert(docx.data, 'docx', format), warnings: [...docx.warnings, { level: 'info', message: `Converted to ${format.toUpperCase()} with LibreOffice` }] }
    }
  }
}

/** Formats that can hold everything the editor supports without warnings in typical documents. */
export const RICH_FORMATS: FormatId[] = ['docx', 'odt']
export const SAVE_FORMATS: FormatId[] = ['docx', 'odt', 'rtf', 'md', 'html', 'txt']
