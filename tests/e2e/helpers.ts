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

export async function launch(opts: { userData?: string; settings?: Record<string, unknown>; env?: Record<string, string> } = {}): Promise<Launched> {
  const userData = opts.userData ?? tempDir('sd-profile-')
  mkdirSync(userData, { recursive: true })
  if (opts.settings) writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(opts.settings))
  // SD_PACKAGED=path/to/binary runs the suite against an electron-builder output instead of the dev build.
  const packaged = process.env.SD_PACKAGED
  // Update checks go to a closed local port unless a test serves a feed: tests never contact GitHub.
  const app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ['.'] }), env: { ...process.env, SD_UPDATE_URL: 'http://127.0.0.1:9', ...opts.env, SIMPLE_DOCS_USER_DATA: userData } })
  const page = await app.firstWindow()
  const violations: string[] = []
  page.on('console', (m) => /Content.Security.Policy/i.test(m.text()) && violations.push(m.text()))
  cspViolations.set(app, violations)
  await page.waitForSelector('[data-testid=dashboard], [data-testid=ribbon]')
  return { app, page, userData }
}

/** Every test fails if the renderer reported a Content-Security-Policy violation. */
const cspViolations = new WeakMap<ElectronApplication, string[]>()

/** Replace native dialogs in the main process with fixed answers. */
export async function stubDialogs(app: ElectronApplication, d: { save?: string; open?: string[] }) {
  await app.evaluate(({ dialog }, d) => {
    if (d.save !== undefined) dialog.showSaveDialog = (async () => ({ canceled: false, filePath: d.save })) as never
    if (d.open !== undefined) dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: d.open })) as never
  }, d)
}

export async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  const v = cspViolations.get(app)
  if (v?.length) throw new Error(`CSP violations:\n${v.join('\n')}`)
}

const mac = process.platform === 'darwin'
/** Caret to the end of the line / of the document (on macOS, End scrolls instead). */
export const LINE_END = mac ? 'Meta+ArrowRight' : 'End'
export const DOC_END = mac ? 'Meta+ArrowDown' : 'Control+End'

export const doc = (page: Page) => page.locator('[data-doc-scroll]:visible .doc-host .ProseMirror')

/** Run a function against the active Tiptap editor inside the renderer. */
export async function withEditor<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const sd = window.__sd; const editor = sd.editors.get(sd.get().active); return (${fn})(editor, sd) })()`) as Promise<T>
}

export async function settle(page: Page, ms = 400) {
  await page.waitForTimeout(ms)
}
