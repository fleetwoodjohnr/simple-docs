// README screenshots (docs/screenshots/*.png) from the built app, with a fresh profile, at the default window size and 100 %
// scale: npm run build && npm run screenshots. On Linux, xvfb-run -a -s "-screen 0 1920x1080x24" npm run screenshots keeps the
// window off your desktop (X11 is forced, or Electron would pick Wayland and the real screen).
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const out = path.resolve('docs/screenshots')
fs.mkdirSync(out, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-screenshots-'))
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ theme: 'light', updateCheck: false }))

const app = await electron.launch({ args: ['.', '--force-device-scale-factor=1', '--ozone-platform=x11'], env: { ...process.env, SIMPLE_DOCS_USER_DATA: profile, SD_UPDATE_URL: 'http://127.0.0.1:9' } })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid=dashboard]')
  const shot = async (name) => {
    await page.waitForTimeout(700)
    await page.evaluate(() => window.__sd.set({ toasts: [] }))
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    console.log(`docs/screenshots/${name}.png`)
  }

  await shot('start')

  await page.getByTestId('template-report').click()
  await page.waitForSelector('.doc-host .ProseMirror')
  await shot('editor')

  await page.evaluate(() => window.__sd.runCommand('view.theme'))
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.evaluate(() => window.__sd.set({ leftPanel: null, rightPanel: 'format' }))
  await shot('dark')

  // The report exported as PDF, open in the PDF editor
  await page.evaluate(() => (window.__sd.runCommand('view.theme'), window.__sd.set({ rightPanel: null })))
  const pdf = path.join(profile, 'Project report.pdf')
  await app.evaluate(({ dialog }, pdf) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdf })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdf] })
  }, pdf)
  await page.keyboard.press('ControlOrMeta+Shift+e')
  while (!fs.existsSync(pdf)) await page.waitForTimeout(200)
  await page.waitForTimeout(500)
  await page.keyboard.press('ControlOrMeta+o')
  await page.waitForSelector('canvas')
  await shot('pdf')
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  fs.rmSync(profile, { recursive: true, force: true })
}
