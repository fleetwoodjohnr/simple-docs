import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
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

    // Create a fillable text field on page 2, fill it
    await page.getByTestId('pdf-tool-field').click()
    const page2 = page.locator('[data-pdf-page="1"]')
    await page2.scrollIntoViewIfNeeded()
    const b2 = (await page2.boundingBox())!
    await page.mouse.move(b2.x + 100, b2.y + 300)
    await page.mouse.down()
    await page.mouse.move(b2.x + 400, b2.y + 330, { steps: 5 })
    await page.mouse.up()
    await expect(page2.getByTestId('pdf-field')).toHaveCount(1)
    await page2.getByTestId('pdf-field').fill('Ada Lovelace')
    await page2.getByTestId('pdf-field').blur()
    await settle(page, 600)
    // Ctrl+Z undoes the fill, Ctrl+Z again removes the field; then redo the work for the save check
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect(page2.getByTestId('pdf-field')).toHaveCount(0)
    await page.mouse.move(b2.x + 100, b2.y + 300)
    await page.mouse.down()
    await page.mouse.move(b2.x + 400, b2.y + 330, { steps: 5 })
    await page.mouse.up()
    await page2.getByTestId('pdf-field').fill('Ada Lovelace')
    await page2.getByTestId('pdf-field').blur()
    await settle(page, 600)
    await page.getByTestId('pdf-tool-select').click()

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
    await expect(page.locator('[data-pdf-page="1"]').getByTestId('pdf-field')).toHaveValue('Ada Lovelace')
    // rotated page shows landscape proportions
    const p2 = (await page.locator('[data-pdf-page="1"]').boundingBox())!
    expect(p2.width).toBeGreaterThan(p2.height)
  } finally {
    await quit(app)
  }
})

test('rotated page: select, highlight, edit and add text, upright on screen', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'rotated.pdf')
  copyFileSync(fixture, file)
  const { app, page } = await launch()
  try {
    await stubDialogs(app, { open: [file] })
    await page.keyboard.press('Control+o')
    const page1 = page.locator('[data-pdf-page="0"]')
    await expect(page1).toBeVisible()
    await page.getByTestId('rotate-0').click({ force: true })
    await settle(page, 800)
    const shown = (await page1.boundingBox())!
    expect(shown.width).toBeGreaterThan(shown.height)

    // The text layer is there, turned with the page: a line of text is taller than wide on screen.
    await page.getByTestId('pdf-tool-highlight').click()
    const word = page1.locator('span[data-run]').filter({ hasText: /^Centered paragraph\.$/ }).first()
    const wb = (await word.boundingBox())!
    expect(wb.height).toBeGreaterThan(wb.width * 2)
    await word.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(r)
    })
    await word.dispatchEvent('mouseup')
    await expect(page.getByTestId('pdf-comments')).toContainText('highlight')

    await page.getByTestId('pdf-tool-edit').click()
    await settle(page, 400)
    if (shotDir) await page.screenshot({ path: path.join(shotDir, 'pdf-rotated-text-layer.png') })
    await page1.locator('span[data-run]').filter({ hasText: /^Introduction$/ }).first().click()
    await page.getByTestId('pdf-input').fill('Overview')
    await page.keyboard.press('Enter')
    await settle(page, 600)

    // New text reads left to right on screen: its line in the text layer is wider than tall.
    await page.getByTestId('pdf-tool-text').click()
    await page.mouse.click(shown.x + 80, shown.y + 80)
    await page.getByTestId('pdf-input').fill('Added upright')
    await page.keyboard.press('Enter')
    await settle(page, 600)
    await page.getByTestId('pdf-tool-select').click()
    const added = (await page1.locator('span[data-run]').filter({ hasText: /^Added upright$/ }).first().boundingBox())!
    expect(added.width).toBeGreaterThan(added.height * 3)
    expect(Math.abs(added.x - (shown.x + 80))).toBeLessThan(12)

    // Fields would read sideways in other viewers: the tool says so instead.
    await page.getByTestId('pdf-tool-field').click()
    await page.mouse.move(shown.x + 300, shown.y + 300)
    await page.mouse.down()
    await page.mouse.move(shown.x + 500, shown.y + 330, { steps: 4 })
    await page.mouse.up()
    await expect(page.getByText(/can’t be added to a rotated page/)).toBeVisible()

    await page.getByTestId('pdf-save').click()
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 15_000 })
    if (existsSync('/usr/bin/pdftotext')) {
      const txt = pdftotext(file, 1)
      expect(txt).toContain('Overview')
      expect(txt).not.toContain('Introduction')
      expect(txt).toContain('Added upright')
    }
  } finally {
    await quit(app)
  }
})

test('OCR: a scanned PDF becomes searchable and keeps its text after save', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'scan.pdf')
  copyFileSync(path.join(__dirname, '../fixtures/scanned.pdf'), file)
  const { app, page } = await launch()
  try {
    await stubDialogs(app, { open: [file] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('pdf-workspace')).toBeVisible()
    await expect(page.getByText(/looks scanned/)).toBeVisible()
    await page.getByTestId('pdf-ocr').click()
    await expect(page.getByText(/Recognized \d+ words/)).toBeVisible({ timeout: 60_000 })
    await page.getByLabel('Search PDF').fill('Fixture Report')
    await expect(page.getByLabel('Search PDF').locator('..')).toContainText('1/1')
    await page.getByLabel('Search PDF').blur()
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 15_000 })
    if (existsSync('/usr/bin/pdftotext')) expect(pdftotext(file)).toContain('Centered paragraph')
  } finally {
    await quit(app)
  }
})

test('password-protected PDF: prompts, rejects a wrong password, opens with the right one', async () => {
  const { app, page } = await launch()
  try {
    await stubDialogs(app, { open: [path.join(__dirname, '../fixtures/protected.pdf')] })
    await page.keyboard.press('Control+o')
    await page.getByLabel('PDF password').fill('wrong')
    await page.keyboard.press('Enter')
    await expect(page.getByText('That password is not correct.')).toBeVisible()
    await page.getByLabel('PDF password').fill('secret')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pdf-workspace')).toBeVisible()
    await expect(page.locator('[data-pdf-page="1"]')).toBeAttached()
  } finally {
    await quit(app)
  }
})

test('print a PDF tab: every page goes to the printer at its own size', async () => {
  const { app, page } = await launch()
  try {
    // Capture the print request in the main process instead of opening the system dialog.
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      ;(globalThis as Record<string, unknown>).__printed = null
      wc.print = ((_o: unknown, cb?: (ok: boolean) => void) => {
        void wc.printToPDF({ preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }).then((b) => {
          ;(globalThis as Record<string, unknown>).__printed = b.toString('base64')
          cb?.(true)
        })
      }) as never
    })
    await stubDialogs(app, { open: [fixture] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('pdf-workspace')).toBeVisible()
    await page.keyboard.press('Control+p')
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).__printed !== null), { timeout: 15_000 }).toBe(true)
    const out = path.join(tempDir(), 'printed.pdf')
    const b64 = await app.evaluate(() => (globalThis as Record<string, unknown>).__printed as string)
    writeFileSync(out, Buffer.from(b64, 'base64'))
    const info = execFileSync('pdfinfo', [out]).toString()
    expect(info).toMatch(/Pages:\s+2/)
    expect(info).toMatch(/Page size:\s+612 x 792/)
  } finally {
    await quit(app)
  }
})
