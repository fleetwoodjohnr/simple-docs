import { test, expect } from '@playwright/test'
import path from 'node:path'
import { doc, launch, quit, stubDialogs, tempDir } from './helpers'

for (const font of [process.platform === 'win32' ? 'Arial' : 'Liberation Sans', 'Calibri']) {
  test(`visible formatting, ribbon and shortcuts, save/reopen: ${font}`, async () => {
    const { app, page } = await launch({ settings: { defaultFont: font } })
    try {
      await page.keyboard.press('ControlOrMeta+n')
      await doc(page).click()
      await page.keyboard.type('Formatting sample')
      await page.keyboard.press('ControlOrMeta+a')
      for (const [label, key, tag] of [['Bold', 'b', 'strong'], ['Italic', 'i', 'em'], ['Underline', 'u', 'u']]) {
        await page.getByRole('button', { name: label, exact: true }).click()
        await expect(doc(page).locator(tag)).toContainText('Formatting sample')
        await page.keyboard.press(`ControlOrMeta+${key}`)
        await expect(doc(page).locator(tag)).toHaveCount(0)
        await page.keyboard.press(`ControlOrMeta+${key}`)
      }
      await expect(doc(page).locator('strong')).toHaveCSS('font-weight', '700')
      await expect(doc(page).locator('em')).toHaveCSS('font-style', 'italic')
      await expect(doc(page).locator('u')).toHaveCSS('text-decoration-line', 'underline')
      await page.evaluate(() => document.fonts.ready)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
      const { root } = await cdp.send('DOM.getDocument')
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.sd-doc u' })
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
      expect(fonts.length).toBeGreaterThan(0)
      expect(fonts.every(f => /bold.*italic|bold.*oblique/i.test(f.postScriptName))).toBe(true)
      for (const ext of ['docx', 'odt']) {
        const file = path.join(tempDir(), `formatted.${ext}`)
        await stubDialogs(app, { save: file })
        await page.keyboard.press('ControlOrMeta+Shift+s')
        await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
        await page.keyboard.press('ControlOrMeta+w')
        await stubDialogs(app, { open: [file] })
        await page.keyboard.press('ControlOrMeta+o')
        await expect(doc(page).locator('strong em u')).toContainText('Formatting sample')
        await doc(page).click()
        await page.keyboard.press('ControlOrMeta+a')
      }
    } finally { await quit(app) }
  })
}
