import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DOC_END, doc, launch, quit, settle, stubDialogs, tempDir } from './helpers'

// Smoke test of an installer build: SD_PACKAGED=release/linux-unpacked/simple-docs npx playwright test packaged
test.skip(!process.env.SD_PACKAGED, 'set SD_PACKAGED to the packaged executable')

test('packaged app: DOCX, equations, spelling, PDF engine and OCR work from inside the asar', async () => {
  const dir = tempDir()
  const { app, page } = await launch()
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    // DOCX import + equation rendering (KaTeX fonts) + spelling (bundled dictionary)
    await stubDialogs(app, { open: [path.join(__dirname, '../fixtures/complex.docx')] })
    await page.keyboard.press('ControlOrMeta+o')
    await expect(doc(page)).toContainText('Fixture Report')
    await doc(page).click()
    await page.keyboard.press(DOC_END)
    await page.keyboard.type(' Speling ')
    await expect(doc(page).locator('.sd-misspelled').filter({ hasText: 'Speling' })).toHaveCount(1, { timeout: 15_000 })
    await page.keyboard.press('Alt+=')
    await page.getByLabel('LaTeX').fill('\\frac{a}{b}')
    await page.getByTestId('equation-save').click()
    await expect(doc(page).locator('.sd-equation .katex')).toBeVisible()
    // PDF export
    const pdfOut = path.join(dir, 'out.pdf')
    await stubDialogs(app, { save: pdfOut })
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect.poll(() => existsSync(pdfOut), { timeout: 15_000 }).toBe(true)
    await settle(page, 500)
    expect(execFileSync('pdfinfo', [pdfOut]).toString()).toMatch(/Pages:\s+\d/)
    // PDF workspace (PDFium WASM via asset IPC) + OCR (tesseract worker from app.asar.unpacked)
    const scan = path.join(dir, 'scan.pdf')
    copyFileSync(path.join(__dirname, '../fixtures/scanned.pdf'), scan)
    await stubDialogs(app, { open: [scan] })
    await page.keyboard.press('ControlOrMeta+o')
    await expect(page.getByTestId('pdf-workspace')).toBeVisible()
    await page.getByTestId('pdf-ocr').click()
    await expect(page.getByText(/Recognized \d+ words/)).toBeVisible({ timeout: 60_000 })
  } finally {
    await quit(app)
  }
})
