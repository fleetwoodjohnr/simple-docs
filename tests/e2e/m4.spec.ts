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

test('protect: read only blocks typing, survives a DOCX round trip, and can be stopped', async () => {
  const { app, page } = await launch()
  const file = path.join(tempDir(), 'locked.docx')
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('Final wording.')
    await page.getByRole('tab', { name: 'Review', exact: true }).click()
    await page.getByRole('button', { name: 'Protect' }).click()
    await page.getByRole('menuitem', { name: 'Read only' }).click()
    await expect(page.getByTestId('protection-bar')).toContainText('Read only')
    await expect(doc(page)).toHaveAttribute('contenteditable', 'false')
    await stubDialogs(app, { save: file })
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
    await page.keyboard.press('Control+w')
    await stubDialogs(app, { open: [file] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('protection-bar')).toContainText('Read only')
    await page.getByTestId('protection-bar').getByRole('button', { name: 'Stop protection' }).click()
    await doc(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited.')
    await expect(doc(page)).toHaveText('Final wording. Edited.')
  } finally {
    await quit(app)
  }
})

test('cover page: inserted from document properties onto its own page', async () => {
  const { app, page } = await launch({ settings: { authorName: 'Ada Lovelace' } })
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('Body text.')
    await withEditor(page, `(e) => e.chain().command(({ tr }) => (tr.setDocAttribute('meta', { title: 'Annual Review' }), true)).run()`)
    await page.getByRole('tab', { name: 'Insert', exact: true }).click()
    await page.getByRole('button', { name: 'Cover page' }).click()
    await page.getByRole('menuitem', { name: /Classic/ }).click()
    await settle(page, 500)
    await expect(page.locator('[data-doc-scroll]:visible .page-sheet')).toHaveCount(2)
    expect(await withEditor(page, `(e) => e.state.doc.content.content.map((n) => n.type.name + ':' + n.textContent)`)).toEqual(
      expect.arrayContaining(['paragraph:Annual Review', 'paragraph:Ada Lovelace', 'pageBreak:', 'paragraph:Body text.'])
    )
  } finally {
    await quit(app)
  }
})

test('citations: add a source, cite it, switch style, insert a bibliography', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('Programs can weave patterns ')
    await page.getByRole('tab', { name: 'References', exact: true }).click()
    await page.getByRole('button', { name: 'Insert citation' }).click()
    await page.getByLabel('Authors').fill('Lovelace, Ada')
    await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Notes on the Analytical Engine')
    await page.getByLabel('Year').fill('1843')
    await page.getByLabel('Publisher').fill('Taylor')
    await page.getByTestId('save-source').click()
    await expect(doc(page).locator('.sd-citation')).toHaveText('(Lovelace, 1843)')
    await page.getByRole('button', { name: 'Bibliography', exact: true }).click()
    await expect(doc(page)).toContainText('References')
    await expect(doc(page)).toContainText('Lovelace, A. (1843). Notes on the Analytical Engine. Taylor.')
    await page.getByRole('button', { name: 'Citation style' }).click()
    await page.getByRole('menuitem', { name: /MLA/ }).click()
    await expect(doc(page).locator('.sd-citation')).toHaveText('(Lovelace)')
    await expect(doc(page)).toContainText('Works Cited')
    await expect(doc(page)).toContainText('Lovelace, Ada. Notes on the Analytical Engine. Taylor, 1843.')
  } finally {
    await quit(app)
  }
})

test('mail merge: CSV recipients, insert fields, preview, merge into a new document', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('Dear ')
    await page.getByRole('tab', { name: 'Tools', exact: true }).click()
    await stubDialogs(app, { open: [path.join(__dirname, '../fixtures/recipients.csv')] })
    await page.getByRole('button', { name: 'Recipients…' }).click()
    await expect(page.getByText(/3 recipients with fields Name, City/)).toBeVisible()
    await page.getByRole('button', { name: 'Insert merge field' }).click()
    await page.getByRole('menuitem', { name: 'Name' }).click()
    await page.keyboard.type(' of ')
    await page.getByRole('button', { name: 'Insert merge field' }).click()
    await page.getByRole('menuitem', { name: 'City' }).click()
    await expect(doc(page)).toHaveText('Dear «Name» of «City»')
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(doc(page)).toHaveText('Dear Lovelace, Ada of London', { useInnerText: true })
    await page.getByRole('button', { name: 'Next recipient' }).click()
    await expect(doc(page)).toHaveText('Dear Alan Turing of Wilmslow', { useInnerText: true })
    await page.getByRole('button', { name: 'Finish & merge' }).click()
    await expect(page.getByRole('tab', { name: /merged/ })).toBeVisible()
    await expect(page.locator('[data-doc-scroll]:visible .page-sheet')).toHaveCount(3)
    await expect(doc(page)).toContainText('Dear Grace Hopper of Arlington')
  } finally {
    await quit(app)
  }
})
