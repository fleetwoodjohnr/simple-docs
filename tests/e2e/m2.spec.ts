import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { doc, launch, quit, settle, stubDialogs, tempDir, withEditor } from './helpers'

const pdfText = (file: string, page: number) => execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', file, '-']).toString()

test('headers, footers and page numbers appear on every page and in the PDF', async () => {
  const { app, page } = await launch()
  const pdf = path.join(tempDir(), 'hf.pdf')
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('First page body')
    await page.keyboard.press('Control+Enter')
    await page.keyboard.type('Second page body')
    await page.keyboard.press('Control+Enter')
    await page.keyboard.type('Third page body')

    // Footer: Insert → Page number → "Page X of Y"
    await page.getByRole('tab', { name: 'Insert', exact: true }).click()
    await page.getByRole('button', { name: 'Page number' }).click()
    await page.getByRole('menuitem', { name: /Page X of Y/ }).click()
    await settle(page)

    // Header: double-click the top margin of page 1 and type
    await page.locator('[data-doc-scroll]:visible').evaluate((el) => (el.scrollTop = 0))
    await settle(page, 200)
    const sheet = page.locator('[data-doc-scroll]:visible .page-sheet').first()
    const box = (await sheet.boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 30)
    await expect(page.getByTestId('hf-toolbar')).toBeVisible()
    await page.keyboard.type('Confidential draft')
    await page.keyboard.press('Escape')
    await settle(page)

    const headers = page.locator('[data-doc-scroll]:visible .sd-hf')
    await expect(headers.filter({ hasText: 'Confidential draft' })).toHaveCount(3)
    await expect(headers.filter({ hasText: 'Page 2 of 3' })).toHaveCount(1)

    await stubDialogs(app, { save: pdf })
    await page.keyboard.press('Control+Shift+e')
    await expect.poll(() => existsSync(pdf) && statSync(pdf).size > 1000, { timeout: 15_000 }).toBe(true)
    for (const n of [1, 2, 3]) {
      const txt = pdfText(pdf, n)
      expect(txt).toContain('Confidential draft')
      expect(txt).toContain(`Page ${n} of 3`)
    }
    // the header lives in the document model, so undo removes it
    expect(await withEditor<string>(page, `(e) => JSON.stringify(e.state.doc.attrs.hf.header.default)`)).toContain('Confidential draft')
  } finally {
    await quit(app)
  }
})
