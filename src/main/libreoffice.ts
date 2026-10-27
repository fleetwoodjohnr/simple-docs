import { execFile } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// LibreOffice is an optional runtime dependency used for RTF / DOC (and ODT until the
// native adapter lands). It is detected, never bundled.

const CANDIDATES: Record<string, string[]> = {
  linux: ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice'],
  darwin: ['/Applications/LibreOffice.app/Contents/MacOS/soffice'],
  win32: ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
}

let cached: string | null | undefined

export function findSoffice(): string | null {
  if (cached !== undefined) return cached
  const fromPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .flatMap((d) => [path.join(d, 'soffice'), path.join(d, 'soffice.exe')])
  cached = [...(CANDIDATES[process.platform] ?? []), ...fromPath].find((p) => existsSync(p)) ?? null
  return cached
}

const EXT = /^(docx|doc|odt|rtf|pdf|html|txt)$/

export async function convert(data: Uint8Array, fromExt: string, toExt: string): Promise<Uint8Array> {
  if (!EXT.test(fromExt) || !EXT.test(toExt)) throw new Error('Unsupported conversion')
  const soffice = findSoffice()
  if (!soffice) throw new Error('LibreOffice is not installed')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-docs-lo-'))
  try {
    const input = path.join(dir, `input.${fromExt}`)
    const outDir = path.join(dir, 'out')
    await fs.writeFile(input, data)
    const filter = toExt === 'docx' ? 'docx:MS Word 2007 XML' : toExt
    await new Promise<void>((resolve, reject) => {
      execFile(
        soffice,
        ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`, '--convert-to', filter, '--outdir', outDir, input],
        { timeout: 120_000 },
        (err) => (err ? reject(err) : resolve())
      )
    })
    return new Uint8Array(await fs.readFile(path.join(outDir, `input.${toExt}`)))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
