import { test, expect } from '@playwright/test'
import path from 'node:path'
import { doc, launch, quit, settle, stubDialogs, tempDir, withEditor } from './helpers'

test('accessibility checker finds issues and fixes them in place', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('Control+n')
    await withEditor(
      page,
      `(e) => e.commands.setContent([
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Report' }] },
        { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Qty' }] }] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4' }] }] }] }] }
      ])`
    )
    await page.getByRole('tab', { name: 'Review', exact: true }).click()
    await page.getByRole('button', { name: 'Accessibility' }).click()
    const panel = page.getByTestId('a11y-panel')
    await expect(panel.locator('[data-rule=image-alt]')).toBeVisible()
    await expect(panel.locator('[data-rule=table-header]')).toBeVisible()
    await panel.getByLabel('Alternative text').fill('Quarterly sales chart')
    await panel.getByLabel('Alternative text').press('Enter')
    await panel.getByRole('button', { name: 'Make first row a header' }).click()
    await panel.getByLabel('Document title').fill('Quarterly report')
    await panel.getByLabel('Document title').press('Enter')
    await expect(page.getByText('No accessibility issues found')).toBeVisible()
    expect(await withEditor(page, `(e) => { let alt = ''; e.state.doc.descendants((n) => { if (n.type.name === 'image') alt = n.attrs.alt }); return [alt, e.state.doc.attrs.meta.title] }`)).toEqual(['Quarterly sales chart', 'Quarterly report'])
  } finally {
    await quit(app)
  }
})

test('version history keeps each save and restores an older one (undoable)', async () => {
  const { app, page } = await launch()
  const file = path.join(tempDir(), 'history.docx')
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('First draft.')
    await stubDialogs(app, { save: file })
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
    await page.keyboard.press('End')
    await page.keyboard.type(' Second draft adds this.')
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
    await settle(page, 300)

    await page.evaluate(() => (window as unknown as { __sd: { runCommand: (id: string) => void } }).__sd.runCommand('file.history'))
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(page.getByTestId('version-preview')).toContainText('Second draft adds this.')
    await options.nth(1).click()
    await expect(page.getByTestId('version-preview')).not.toContainText('Second draft')
    await page.getByTestId('restore-version').click()
    await expect(doc(page)).toHaveText('First draft.')
    await doc(page).click()
    await page.keyboard.press('Control+z')
    await expect(doc(page)).toContainText('Second draft adds this.')
  } finally {
    await quit(app)
  }
})

test('compare: an edited DOCX against the original file opens a comparison with tracked changes', async () => {
  const { app, page } = await launch()
  const fixture = path.join(__dirname, '../fixtures/complex.docx')
  try {
    await stubDialogs(app, { open: [fixture] })
    await page.keyboard.press('Control+o')
    await expect(doc(page)).toContainText('Fixture Report')
    await withEditor(page, `(e) => { let pos = 0; e.state.doc.descendants((n, p) => { if (!pos && n.isText && n.text.includes('Centered paragraph')) pos = p }); e.chain().insertContentAt({ from: pos, to: pos + 8 }, 'Middle').run() }`)
    await stubDialogs(app, { open: [fixture] })
    await page.evaluate(() => (window as unknown as { __sd: { runCommand: (id: string) => void } }).__sd.runCommand('review.compare'))
    await expect(page.getByRole('tab', { name: /comparison/ })).toBeVisible()
    await expect(doc(page).locator('.sd-del')).toHaveText('Centered')
    await expect(doc(page).locator('.sd-ins')).toHaveText('Middle')
    await expect(page.getByText(/1 insertion, 1 deletion/)).toBeVisible()
  } finally {
    await quit(app)
  }
})
