import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { doc, launch, quit, tempDir } from './helpers'

test('a crashed renderer reloads and offers the unsaved work back; corrupt snapshots are skipped', async () => {
  const userData = tempDir('sd-profile-')
  // A truncated snapshot left by an earlier crash must not break start-up.
  mkdirSync(path.join(userData, 'recovery'), { recursive: true })
  writeFileSync(path.join(userData, 'recovery', 'broken.json'), '{"id":"broken","savedAt":17')
  const { app, page } = await launch({ userData, settings: { recoveryIntervalSec: 1 } })
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('Work that must survive a renderer crash')
    await expect.poll(() => (existsSync(path.join(userData, 'recovery')) ? readdirSync(path.join(userData, 'recovery')).length : 0), { timeout: 10_000 }).toBeGreaterThan(1)
    await page.waitForTimeout(1500) // let the latest keystrokes reach the snapshot

    // After the crash the main process reloads the window. Playwright keeps the page marked as crashed,
    // so the reloaded renderer is driven through the main process.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
    const js = (code: string) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(c), code)
    await expect.poll(() => js(`document.querySelectorAll('[data-testid=recovery] button').length`).catch(() => -1), { timeout: 20_000 }).toBeGreaterThan(0)
    // the corrupt snapshot is not listed: exactly one Restore
    expect(await js(`[...document.querySelectorAll('[data-testid=recovery] button')].filter((b) => b.textContent.trim() === 'Restore').length`)).toBe(1)
    await js(`[...document.querySelectorAll('[data-testid=recovery] button')].find((b) => b.textContent.trim() === 'Restore').click()`)
    await expect.poll(() => js(`document.querySelector('[data-doc-scroll] .ProseMirror')?.textContent ?? ''`), { timeout: 10_000 }).toContain('Work that must survive a renderer crash')
  } finally {
    await quit(app)
  }
})
