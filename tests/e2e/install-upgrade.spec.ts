import { test, expect } from '@playwright/test'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { doc, launch, quit, stubDialogs } from './helpers'

test.skip(!process.env.SD_UPGRADE_STAGE, 'Windows installation workflow only')
test('installed upgrade preserves settings and a saved document', async () => {
  const before = process.env.SD_UPGRADE_STAGE === 'before'
  const userData = process.env.SD_UPGRADE_PROFILE!
  const file = path.join(userData, 'upgrade.docx')
  const { app, page } = await launch({ userData, ...(before ? { settings: { theme: 'dark', updateCheck: false } } : {}) })
  try {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(before ? '0.2.0' : JSON.parse(readFileSync('package.json', 'utf8')).version)
    expect(await page.evaluate(() => window.simpleDocs.settingsGet())).toMatchObject({ theme: 'dark', updateCheck: false })
    if (before) {
      await page.keyboard.press('ControlOrMeta+n')
      await doc(page).click()
      await page.keyboard.type('Document retained across upgrade')
      await stubDialogs(app, { save: file })
      await page.keyboard.press('ControlOrMeta+s')
      await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
    } else {
      await stubDialogs(app, { open: [file] })
      await page.keyboard.press('ControlOrMeta+o')
      await expect(doc(page)).toContainText('Document retained across upgrade')
    }
  } finally { await quit(app) }
})
