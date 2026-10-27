// Usage: node scripts/shot.mjs <out.png> [evalJsFile]
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
const [out, js] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], env: { ...process.env, SIMPLE_DOCS_USER_DATA: process.env.SIMPLE_DOCS_USER_DATA || '/tmp/claude-1000/sd-shot-profile' } })
const win = await app.firstWindow()
const logs = []
win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
if (js) console.log('eval:', JSON.stringify(await win.evaluate(fs.readFileSync(js, 'utf8'))))
await win.waitForTimeout(500)
await win.screenshot({ path: out })
console.log(logs.join('\n'))
await app.evaluate(({ app }) => app.exit(0))
