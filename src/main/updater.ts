import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as store from './store'

// Updates come from the GitHub releases named in electron-builder.yml (`publish`). Nothing is downloaded until the user
// clicks Install; downloads are checked against the sha512 in the release's latest*.yml.
const RELEASES = 'https://github.com/fleetwoodjohnr/simple-docs/releases'
const DAY = 24 * 60 * 60 * 1000
const isMac = process.platform === 'darwin'

let configured = false
let busy = false
let restartForUpdate = false

function updater() {
  if (!configured) {
    configured = true
    autoUpdater.autoDownload = false
    // Packaged E2E tests point the updater at a local feed (loopback only); a test update is never installed on quit.
    const feed = process.env.SD_UPDATE_URL
    if (feed?.startsWith('http://127.0.0.1:')) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed })
      autoUpdater.autoInstallOnAppQuit = false
    }
  }
  return autoUpdater
}

/** Asks GitHub for a newer version. A manual check always reports the outcome; the automatic one speaks only if there is an update. */
export async function checkForUpdates(win: BrowserWindow | null, manual: boolean): Promise<void> {
  const box = (o: MessageBoxOptions) => (win && !win.isDestroyed() ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o))
  if (!app.isPackaged) {
    if (manual) await box({ type: 'info', message: 'Updates are checked in installed builds only', detail: 'This is a development build.' })
    return
  }
  if (busy) return
  busy = true
  let report = manual
  try {
    const result = await updater().checkForUpdates()
    const info = result?.isUpdateAvailable ? result.updateInfo : null
    if (!info) {
      if (manual) await box({ type: 'info', message: 'Simple Docs is up to date', detail: `Version ${app.getVersion()}` })
      return
    }
    // macOS only applies updates to apps with a Developer ID signature, and ours are signed ad hoc: download by hand.
    const { response } = await box({
      type: 'info',
      message: `Simple Docs ${info.version} is available`,
      detail: `You have version ${app.getVersion()}.${isMac ? ' The download page opens in your browser.' : ''}`,
      buttons: [isMac ? 'Download' : 'Install', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return
    report = true
    if (isMac) return void (await shell.openExternal(`${RELEASES}/tag/v${info.version}`))
    await updater().downloadUpdate()
    const ready = await box({
      type: 'info',
      message: `Simple Docs ${info.version} is ready to install`,
      detail: 'Restart now, or it installs the next time you quit Simple Docs.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (ready.response === 0) {
      // Closing the window runs the usual unsaved-documents check; window-all-closed then installs.
      restartForUpdate = true
      win?.close()
    }
  } catch (e) {
    if (report) await box({ type: 'error', message: 'Couldn’t update Simple Docs', detail: (e as Error).message })
  } finally {
    busy = false
  }
}

/** Called once the window has closed: installs a downloaded update and relaunches. False if there is nothing to install. */
export function installIfRequested(): boolean {
  if (!restartForUpdate) return false
  updater().quitAndInstall(true, true)
  return true
}

/** The automatic check: shortly after startup, at most once a day, unless turned off in Settings → Updates. */
export function scheduleUpdateCheck(win: () => BrowserWindow | null) {
  if (!app.isPackaged) return
  setTimeout(async () => {
    const s = await store.getSettings()
    if (!s.updateCheck || Date.now() - s.lastUpdateCheck < DAY) return
    await store.setSettings({ lastUpdateCheck: Date.now() })
    await checkForUpdates(win(), false)
  }, 10_000)
}
