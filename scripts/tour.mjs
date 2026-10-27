import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
const out = process.argv[2]
fs.rmSync('/tmp/claude-1000/sd-tour', { recursive: true, force: true })
const app = await electron.launch({ args: ['.'], env: { ...process.env, SIMPLE_DOCS_USER_DATA: '/tmp/claude-1000/sd-tour' } })
const page = await app.firstWindow()
await page.waitForSelector('[data-testid=dashboard]')
const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${n}.png` }) }
await page.evaluate(() => document.querySelector('[data-testid=template-report]').click())
await page.waitForTimeout(600)
// select a word to show floating toolbar
await page.evaluate(() => { const sd = window.__sd; const e = sd.editors.get(sd.get().active); e.commands.setTextSelection({ from: 60, to: 75 }); e.commands.focus() })
await shot('t1-home-selection')
await page.getByRole('tab', { name: 'Insert' }).click(); await shot('t2-insert')
await page.getByRole('tab', { name: 'Layout' }).click(); await shot('t3-layout')
await page.getByRole('tab', { name: 'View', exact: true }).click(); await shot('t4-view')
await page.keyboard.press('Control+f'); await page.keyboard.type('the'); await shot('t5-find')
await page.keyboard.press('Escape')
await page.evaluate(() => window.__sd.set({ rightPanel: 'format' }))
await page.evaluate(() => window.__sd.runCommand('view.theme'))
await shot('t6-dark')
await page.evaluate(() => window.__sd.set({ dialog: { kind: 'settings' } })); await shot('t7-settings')
await page.keyboard.press('Escape')
await page.evaluate(() => window.__sd.set({ active: 'home' })); await shot('t8-dark-home')
await app.evaluate(({ app }) => app.exit(0))
