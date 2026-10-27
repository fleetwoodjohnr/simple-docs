import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
}

export function tempDir(prefix = 'sd-e2e-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

export async function launch(opts: { userData?: string; settings?: Record<string, unknown> } = {}): Promise<Launched> {
  const userData = opts.userData ?? tempDir('sd-profile-')
  mkdirSync(userData, { recursive: true })
  if (opts.settings) writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(opts.settings))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SIMPLE_DOCS_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid=dashboard], [data-testid=ribbon]')
  return { app, page, userData }
}

/** Replace native dialogs in the main process with fixed answers. */
export async function stubDialogs(app: ElectronApplication, d: { save?: string; open?: string[] }) {
  await app.evaluate(({ dialog }, d) => {
    if (d.save !== undefined) dialog.showSaveDialog = (async () => ({ canceled: false, filePath: d.save })) as never
    if (d.open !== undefined) dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: d.open })) as never
  }, d)
}

export async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
}

export const doc = (page: Page) => page.locator('[data-doc-scroll]:visible .sd-doc')

/** Run a function against the active Tiptap editor inside the renderer. */
export async function withEditor<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const sd = window.__sd; const editor = sd.editors.get(sd.get().active); return (${fn})(editor, sd) })()`) as Promise<T>
}

export async function settle(page: Page, ms = 400) {
  await page.waitForTimeout(ms)
}
