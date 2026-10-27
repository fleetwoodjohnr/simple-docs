import { existsSync } from 'node:fs'
import path from 'node:path'

/** Full path of a command on PATH (poppler, LibreOffice…), or null: checks that need one skip without it. */
export function tool(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter))
    for (const ext of exts) if (dir && existsSync(path.join(dir, name + ext))) return path.join(dir, name + ext)
  return null
}

export const soffice = tool('soffice') ?? tool('libreoffice')
export const hasPoppler = !!tool('pdftotext')
