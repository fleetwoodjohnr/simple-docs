import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { doc, launch, quit, stubDialogs, tempDir } from './helpers'

for (const action of ['Cancel', 'Don’t save', 'Save']) {
  test(`closing edited documents: ${action}`, async () => {
    const { app, page } = await launch()
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    let exited = false
    app.process().once('exit', () => { exited = true })
    const file = path.join(tempDir(), 'saved.docx')
    try {
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press('ControlOrMeta+n')
        await doc(page).click()
        await page.keyboard.type(`Document ${i}`)
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
      await expect(page.getByRole('dialog')).toContainText('2 documents')
      if (action === 'Save') await stubDialogs(app, { save: file })
      await page.getByRole('button', { name: action, exact: true }).click().catch(async error => {
        if (action === 'Cancel') throw error
        // Closing the transport can precede Playwright's page-closed event. Require real process exit.
        await expect.poll(() => exited).toBe(true)
      })
      if (action === 'Cancel') {
        await expect(doc(page)).toContainText('Document 1')
        expect(exited).toBe(false)
      } else {
        await expect.poll(() => exited).toBe(true)
        if (action === 'Save') expect(existsSync(file)).toBe(true)
      }
      expect(errors).toEqual([])
    } finally { await quit(app) }
  })
}

test('closing from the start screen exits the process', async () => {
  const { app } = await launch()
  let exited = false
  app.process().once('exit', () => { exited = true })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect.poll(() => exited).toBe(true)
  } finally { await quit(app) }
})

test('canceling Save As or a failed save leaves the document open', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await page.keyboard.type('Keep my work')
    await app.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: undefined })) as never
      BrowserWindow.getAllWindows()[0].close()
    })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await stubDialogs(app, { save: path.join(tempDir(), 'missing', 'fail.docx') })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(/Save failed:/)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(doc(page)).toContainText('Keep my work')
  } finally { await quit(app) }
})
