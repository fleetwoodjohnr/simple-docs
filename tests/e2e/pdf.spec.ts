import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { launch, quit, settle, stubDialogs, tempDir } from './helpers'

const fixture = path.join(__dirname, '../fixtures/complex.pdf')
const pdftotext = (f: string, pageNo?: number) => execFileSync('pdftotext', [...(pageNo ? ['-f', String(pageNo), '-l', String(pageNo)] : []), f, '-']).toString()
const shotDir = process.env.SD_SHOTS

test('acceptance 15–16: open a PDF, annotate, edit text, redact, save and reopen', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'report.pdf')
  copyFileSync(fixture, file)
  const { app, page } = await launch({ settings: { authorName: 'PDF Reviewer' } })
  try {
    await stubDialogs(app, { open: [file] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('pdf-workspace')).toBeVisible()
    const page1 = page.locator('[data-pdf-page="0"]')
    await expect(page1).toBeVisible()
    await settle(page, 800)

    // Highlight: select a word in the text layer with the highlight tool.
    await page.getByTestId('pdf-tool-highlight').click()
    await settle(page, 400)
    const word = page1.locator('span[data-run]').filter({ hasText: /^Centered paragraph\.$/ }).first()
    await word.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
    })
    await word.dispatchEvent('mouseup')
    await expect(page.getByTestId('pdf-comments')).toContainText('highlight')

    // Note
    await page.getByTestId('pdf-tool-note').click()
    const box = (await page1.boundingBox())!
    await page.mouse.click(box.x + box.width - 60, box.y + 60)
    await page.getByTestId('pdf-input').fill('Please verify this page')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pdf-comments')).toContainText('Please verify this page')

    // Edit existing text
    await page.getByTestId('pdf-tool-edit').click()
    await settle(page, 400)
    await page1.locator('span[data-run]').filter({ hasText: /^Introduction$/ }).first().click()
    await page.getByTestId('pdf-input').fill('Overview')
    await page.keyboard.press('Enter')
    await settle(page, 600)

    // Redact the header line (locate it while the text layer is shown, then draw with the redact tool)
    const header = await page1.locator('span[data-run]').filter({ hasText: 'Fixture header text' }).first().boundingBox()
    await page.getByTestId('pdf-tool-redact').click()
    // redact tool hides the text layer; draw over the header line
    await page.mouse.move(header!.x - 4, header!.y - 4)
    await page.mouse.down()
    await page.mouse.move(header!.x + header!.width + 4, header!.y + header!.height + 4, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByTestId('pending-redaction')).toHaveCount(1)
    await page.getByTestId('apply-redactions').click()
    await page.getByTestId('confirm-redact').click()
    await settle(page, 800)
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'pdf-workspace.png') })

    // Rotate page 2, save, reopen
    await page.getByTestId('rotate-1').click({ force: true })
    await settle(page, 600)
    await page.getByTestId('pdf-save').click()
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 15_000 })

    if (existsSync('/usr/bin/pdftotext')) {
      const txt = pdftotext(file, 1)
      expect(txt).toContain('Overview')
      expect(txt).not.toContain('Introduction')
      expect(txt).not.toContain('Fixture header text') // redacted on page 1
      expect(pdftotext(file, 2)).toContain('Fixture header text') // untouched on page 2
      expect(txt).toContain('Centered paragraph.')
    }
    await page.keyboard.press('Control+w')
    await stubDialogs(app, { open: [file] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('pdf-workspace')).toBeVisible()
    await expect(page.getByTestId('pdf-comments')).toContainText('highlight', { timeout: 10_000 })
    await expect(page.getByTestId('pdf-comments')).toContainText('Please verify this page')
    await expect(page.getByTestId('pdf-comments')).toContainText('PDF Reviewer')
    // rotated page shows landscape proportions
    const p2 = (await page.locator('[data-pdf-page="1"]').boundingBox())!
    expect(p2.width).toBeGreaterThan(p2.height)
  } finally {
    await quit(app)
  }
})
