import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { exportDocx } from '@/formats/docx/write'
import { importDocx, type DocxCarry } from '@/formats/docx/read'
import { exportOdt } from '@/formats/odt/write'
import { importOdt } from '@/formats/odt/read'
import { fromBase64 } from '@/formats/docx/xml'
import { tool } from '../tools'

// A 1×1 PNG stands in for the picture of page 1.
const PNG = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello preview' }] }] }
const thumbnailer = tool('gsf-office-thumbnailer')

describe('first-page preview embedded in saved files', () => {
  it('DOCX: docProps/thumbnail.png, linked from the package relationships; re-saving replaces it', () => {
    const files = unzipSync(exportDocx(doc, null, PNG).data)
    expect(files['docProps/thumbnail.png']).toEqual(PNG)
    expect(strFromU8(files['_rels/.rels'])).toContain('Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.png"')
    const back = importDocx(exportDocx(doc, null, PNG).data)
    expect(JSON.stringify(back.doc)).toContain('Hello preview')
    // Re-saved without a new picture, the old one is dropped rather than left stale.
    expect(unzipSync(exportDocx(back.doc, back.carry as DocxCarry).data)['docProps/thumbnail.png']).toBeUndefined()
    expect(unzipSync(exportDocx(doc).data)['docProps/thumbnail.png']).toBeUndefined()
  })

  it('ODT: Thumbnails/thumbnail.png, listed in the manifest', () => {
    const files = unzipSync(exportOdt(doc, PNG).data)
    expect(files['Thumbnails/thumbnail.png']).toEqual(PNG)
    expect(strFromU8(files['META-INF/manifest.xml'])).toContain('<manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/>')
    expect(JSON.stringify(importOdt(exportOdt(doc, PNG).data).doc)).toContain('Hello preview')
  })

  it.skipIf(!thumbnailer)('the desktop thumbnailer (libgsf) finds the preview in both', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sd-thumb-'))
    for (const [name, data] of [['a.docx', exportDocx(doc, null, PNG).data], ['a.odt', exportOdt(doc, PNG).data]] as const) {
      writeFileSync(path.join(dir, name), data)
      execFileSync(thumbnailer!, ['-i', path.join(dir, name), '-o', path.join(dir, `${name}.png`), '-s', '128'])
      expect([...readFileSync(path.join(dir, `${name}.png`)).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]) // "PNG"
    }
  })
})
