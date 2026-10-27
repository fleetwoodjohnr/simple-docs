import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import path from 'node:path'
import { doc, launch, quit, settle, stubDialogs } from './helpers'

// WCAG 2.2 AA checks (axe-core) on the main screens, light and dark.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violations(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).exclude('.ProseMirror-separator').analyze()
  return r.violations.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}×: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`)
}

for (const theme of ['light', 'dark'] as const)
  test(`accessibility (axe, WCAG 2.2 AA): main screens, ${theme}`, async () => {
    const { app, page } = await launch({ settings: { theme } })
    const found: string[] = []
    try {
      found.push(...(await violations(page, 'dashboard')))
      await page.keyboard.press('ControlOrMeta+n')
      await doc(page).click()
      await page.keyboard.type('Accessible heading and body text.')
      await settle(page, 400)
      found.push(...(await violations(page, 'editor (Home)')))
      for (const tab of ['Insert', 'Layout', 'References', 'Review', 'View', 'Tools']) {
        await page.getByRole('tab', { name: tab, exact: true }).click()
        found.push(...(await violations(page, `ribbon ${tab}`)))
      }
      await page.evaluate(() => (window as unknown as { __sd: { runCommand: (id: string) => void } }).__sd.runCommand('tools.settings'))
      await expect(page.getByRole('dialog')).toBeVisible()
      found.push(...(await violations(page, 'settings')))
      await page.keyboard.press('Escape')
      await stubDialogs(app, { open: [path.join(__dirname, '../fixtures/complex.pdf')] })
      await page.keyboard.press('ControlOrMeta+o')
      await expect(page.getByTestId('pdf-workspace')).toBeVisible()
      await settle(page, 800)
      found.push(...(await violations(page, 'pdf workspace')))
    } finally {
      await quit(app)
    }
    expect(found, found.join('\n')).toEqual([])
  })
