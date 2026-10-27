// Regenerates third-party fixtures from hand-written flat ODT using LibreOffice.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
const profile = mkdtempSync(path.join(tmpdir(), 'sd-lo-'))
for (const f of readdirSync(path.join(dir, 'src')).filter((f) => f.endsWith('.fodt'))) {
  for (const fmt of ['docx:MS Word 2007 XML', 'odt', 'rtf', 'pdf']) {
    execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${profile}`, '--convert-to', fmt, '--outdir', dir, path.join(dir, 'src', f)], { stdio: 'inherit' })
  }
}
rmSync(profile, { recursive: true, force: true })
