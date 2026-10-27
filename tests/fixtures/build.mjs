// Regenerates third-party fixtures from hand-written flat ODT using LibreOffice (plus poppler + ImageMagick for the scan).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
const profile = mkdtempSync(path.join(tmpdir(), 'sd-lo-'))
for (const f of readdirSync(path.join(dir, 'src')).filter((f) => f.endsWith('.fodt'))) {
  for (const fmt of ['docx:MS Word 2007 XML', 'odt', 'rtf', 'pdf']) {
    execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${profile}`, '--convert-to', fmt, '--outdir', dir, path.join(dir, 'src', f)], { stdio: 'inherit' })
  }
}
// Password-protected PDF (open password "secret").
const enc = mkdtempSync(path.join(tmpdir(), 'sd-enc-'))
const opts = JSON.stringify({ EncryptFile: { type: 'boolean', value: 'true' }, DocumentOpenPassword: { type: 'string', value: 'secret' } })
execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${profile}`, '--convert-to', `pdf:writer_pdf_Export:${opts}`, '--outdir', enc, path.join(dir, 'src', 'complex.fodt')], { stdio: 'inherit' })
renameSync(path.join(enc, 'complex.pdf'), path.join(dir, 'protected.pdf'))
rmSync(enc, { recursive: true, force: true })
rmSync(profile, { recursive: true, force: true })

// A "scanned" PDF: page 1 rasterized (poppler) and wrapped as an image-only PDF (ImageMagick) — no text layer.
const tmp = mkdtempSync(path.join(tmpdir(), 'sd-scan-'))
execFileSync('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '1', '-singlefile', path.join(dir, 'complex.pdf'), path.join(tmp, 'scan')])
execFileSync('magick', [path.join(tmp, 'scan.png'), '-units', 'PixelsPerInch', '-density', '150', path.join(dir, 'scanned.pdf')])
rmSync(tmp, { recursive: true, force: true })
