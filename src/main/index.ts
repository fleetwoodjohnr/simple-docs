import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OpenedFile, RecentFile, Settings } from '../shared/ipc-types'
import * as store from './store'
import * as lo from './libreoffice'
import { recognize, stopOcr } from './ocr'
import { aiStatus, cancelAi, runAi, setApiKey } from './ai'

const isMac = process.platform === 'darwin'
const DOC_EXTENSIONS = ['docx', 'odt', 'md', 'markdown', 'html', 'htm', 'txt', 'rtf', 'doc', 'pdf']
const MAX_FILE_BYTES = 512 * 1024 * 1024

let mainWindow: BrowserWindow | null = null
let allowClose = false
const pendingOpen: string[] = []

// Paths the user granted through a dialog, recents, argv, or drag-and-drop.
// The renderer can only read/write these.
const granted = new Set<string>()

const isAbs = (p: unknown): p is string => typeof p === 'string' && p.length < 4096 && !p.includes('\0') && path.isAbsolute(p)
const isBytes = (d: unknown): d is Uint8Array => d instanceof Uint8Array
const extOf = (p: string) => path.extname(p).slice(1).toLowerCase()

function grant(p: string) {
  granted.add(path.resolve(p))
}

function assertGranted(p: unknown): string {
  if (!isAbs(p)) throw new Error('Invalid path')
  const r = path.resolve(p)
  if (!granted.has(r)) throw new Error('Access to this file was not granted')
  return r
}

async function readOpened(p: string): Promise<OpenedFile> {
  const st = await fs.stat(p)
  if (!st.isFile()) throw new Error('Not a file')
  if (st.size > MAX_FILE_BYTES) throw new Error('File is too large')
  const data = new Uint8Array(await fs.readFile(p))
  return { path: p, name: path.basename(p), data, mtime: st.mtimeMs }
}

function filesFromArgv(argv: string[]): string[] {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && isAbs(path.resolve(a)) && DOC_EXTENSIONS.includes(extOf(a)))
}

async function sendOpenFiles(paths: string[]) {
  if (!mainWindow) {
    pendingOpen.push(...paths)
    return
  }
  const files: OpenedFile[] = []
  for (const p of paths) {
    try {
      grant(p)
      files.push(await readOpened(path.resolve(p)))
    } catch {
      /* unreadable file: skip */
    }
  }
  if (files.length) mainWindow.webContents.send('app:open-files', files)
}

function createWindow(settings: Settings) {
  nativeTheme.themeSource = settings.theme
  allowClose = false
  const dark = nativeTheme.shouldUseDarkColors
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'Simple Docs',
    backgroundColor: dark ? '#111113' : '#f6f6f7',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: dark ? '#d4d4d8' : '#3f3f46', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    mainWindow?.webContents.send('app:close-request')
  })
  // A crashed renderer reloads; the app then offers the recovery snapshots (written every few seconds).
  const crashes: number[] = []
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    crashes.push(Date.now())
    while (crashes.length && Date.now() - crashes[0] > 60_000) crashes.shift()
    if (crashes.length <= 3) mainWindow?.reload()
    else void dialog.showMessageBox({ type: 'error', message: 'Simple Docs keeps crashing.', detail: 'Your recent changes are kept in recovery snapshots. Restart the app to restore them.' })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(settings.uiScale || 1)
    if (pendingOpen.length) void sendOpenFiles(pendingOpen.splice(0))
  })
}

function buildMenu() {
  const send = (id: string) => () => mainWindow?.webContents.send('app:menu-command', id)
  if (!isMac) {
    // The ribbon replaces the menu bar on Windows/Linux; Chromium still handles clipboard keys.
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New', click: send('file.new') },
        { label: 'Open…', click: send('file.open') },
        { type: 'separator' },
        { label: 'Save', click: send('file.save') },
        { label: 'Save As…', click: send('file.saveAs') },
        { label: 'Export PDF…', click: send('file.exportPdf') },
        { type: 'separator' },
        { label: 'Print…', click: send('file.print') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function hardenSessions() {
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'local-fonts', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  // The renderer runs its own offline spellchecker; Chromium's would download dictionaries on Linux.
  session.defaultSession.setSpellCheckerEnabled(false)

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (ev, url) => {
      if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return
      ev.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => Promise<R> | R) {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.sender !== mainWindow?.webContents) throw new Error('Unknown sender')
    return fn(e, ...(args as A))
  })
}

function registerIpc() {
  handle('files:open-dialog', async (_e, filter?: unknown) => {
    const f = filter as { name?: unknown; extensions?: unknown } | undefined
    const custom = f && typeof f.name === 'string' && Array.isArray(f.extensions) && f.extensions.every((x) => typeof x === 'string' && /^[a-z0-9]{1,8}$/.test(x)) ? { name: f.name.slice(0, 60), extensions: f.extensions as string[] } : null
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: custom ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [custom ?? { name: 'Documents', extensions: DOC_EXTENSIONS }, { name: 'All files', extensions: ['*'] }]
    })
    const out: OpenedFile[] = []
    for (const p of res.filePaths) {
      grant(p)
      out.push(await readOpened(p))
    }
    return out
  })

  handle('files:read', async (_e, p: unknown) => readOpened(assertGranted(p)))

  handle('files:save-dialog', async (_e, defaultName: unknown, extensions: unknown) => {
    if (typeof defaultName !== 'string' || !Array.isArray(extensions) || !extensions.every((x) => typeof x === 'string' && /^[a-z0-9]{1,8}$/.test(x))) {
      throw new Error('Invalid arguments')
    }
    const res = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultName.replace(/[\\/:*?"<>|]/g, '_'),
      filters: extensions.map((x) => ({ name: x.toUpperCase(), extensions: [x] }))
    })
    if (res.canceled || !res.filePath) return null
    grant(res.filePath)
    return res.filePath
  })

  handle('files:write', async (_e, p: unknown, data: unknown) => {
    const target = assertGranted(p)
    if (!isBytes(data)) throw new Error('Invalid data')
    await store.atomicWrite(target, data)
    return { mtime: (await fs.stat(target)).mtimeMs }
  })

  handle('files:grant-dropped', (_e, p: unknown) => {
    if (!isAbs(p) || !DOC_EXTENSIONS.includes(extOf(p))) return false
    grant(p)
    return true
  })

  handle('recent:list', async () => {
    const list = await store.listRecents()
    list.forEach((r) => grant(r.path))
    return list
  })
  handle('recent:add', (_e, entry: RecentFile) => {
    if (!entry || !isAbs(entry.path) || typeof entry.name !== 'string') throw new Error('Invalid entry')
    assertGranted(entry.path)
    return store.addRecent({ path: entry.path, name: entry.name, openedAt: Date.now(), thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : undefined })
  })
  handle('recent:update', (_e, p: unknown, patch: Partial<RecentFile>) => {
    if (!isAbs(p) || typeof patch !== 'object' || !patch) throw new Error('Invalid arguments')
    const safe: Partial<RecentFile> = {}
    if (typeof patch.pinned === 'boolean') safe.pinned = patch.pinned
    if (typeof patch.favorite === 'boolean') safe.favorite = patch.favorite
    if (typeof patch.thumbnail === 'string' && patch.thumbnail.startsWith('data:image/')) safe.thumbnail = patch.thumbnail
    if (typeof patch.openedAt === 'number') safe.openedAt = patch.openedAt
    return store.updateRecent(p, safe)
  })
  handle('recent:remove', (_e, p: unknown) => {
    if (!isAbs(p)) throw new Error('Invalid path')
    return store.removeRecent(p)
  })

  handle('recovery:write', (_e, id: unknown, payload: unknown) => {
    if (typeof id !== 'string' || typeof payload !== 'string') throw new Error('Invalid arguments')
    return store.writeRecovery(id, payload)
  })
  handle('recovery:list', () => store.listRecovery())
  handle('history:add', (_e, p: unknown, json: unknown, auto: unknown) => {
    if (!isAbs(p) || typeof json !== 'string') throw new Error('Invalid arguments')
    return store.addVersion(p, json, auto ? 10 * 60_000 : 0)
  })
  handle('history:list', (_e, p: unknown) => (isAbs(p) ? store.listVersions(p) : []))
  handle('history:read', (_e, p: unknown, id: unknown) => {
    if (!isAbs(p) || typeof id !== 'string') throw new Error('Invalid arguments')
    return store.readVersion(p, id)
  })
  handle('recovery:remove', (_e, id: unknown) => (typeof id === 'string' ? store.removeRecovery(id) : undefined))

  handle('settings:get', () => store.getSettings())
  handle('settings:set', async (_e, patch: Partial<Settings>) => {
    if (typeof patch !== 'object' || !patch) throw new Error('Invalid settings')
    const next = await store.setSettings(patch)
    if (patch.theme) nativeTheme.themeSource = next.theme
    if (patch.uiScale) mainWindow?.webContents.setZoomFactor(next.uiScale)
    return next
  })

  handle('pdf:export', async (e) => {
    const buf = await e.sender.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      generateTaggedPDF: true,
      generateDocumentOutline: true
    })
    return new Uint8Array(buf)
  })

  handle('print', (e) => new Promise<boolean>((resolve) => e.sender.print({ printBackground: true }, (ok) => resolve(ok))))

  handle('capture-page', async (e, rect: { x: number; y: number; width: number; height: number }) => {
    const r = Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, Math.max(0, Math.round(Number((rect as never)[k]) || 0))]))
    const img = await e.sender.capturePage(r as never)
    // 256 px wide PNG: the preview embedded in saved files (and the recents thumbnail). Hidden windows capture nothing.
    return img.isEmpty() ? null : new Uint8Array(img.resize({ width: 256, quality: 'best' }).toPNG())
  })

  handle('asset:read', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('file:')) throw new Error('Invalid asset URL')
    const file = path.resolve(fileURLToPath(url))
    const root = path.resolve(path.join(__dirname, '../renderer'))
    if (!file.startsWith(root + path.sep) || !/\.(wasm|traineddata(\.gz)?)$/.test(file)) throw new Error('Asset outside the app')
    return new Uint8Array(await fs.readFile(file))
  })
  handle('ai:status', () => aiStatus())
  handle('ai:set-key', (_e, key: unknown) => {
    if (key !== null && (typeof key !== 'string' || key.length > 400 || /\s/.test(key.trim()))) throw new Error('Invalid key')
    return setApiKey(key as string | null)
  })
  handle('ai:run', async (e, id: unknown, action: unknown, instruction: unknown, text: unknown) => {
    // Enforced here too, not only in the UI: no request leaves the app while the assistant is off.
    if (!(await store.getSettings()).aiEnabled) throw new Error('The AI assistant is turned off (Settings → AI assistant).')
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || typeof action !== 'string' || typeof instruction !== 'string' || instruction.length > 2000 || typeof text !== 'string') throw new Error('Invalid arguments')
    return runAi(id, action, instruction, text, (delta) => !e.sender.isDestroyed() && e.sender.send('ai:text', id, delta))
  })
  handle('ai:cancel', (_e, id: unknown) => (typeof id === 'string' ? cancelAi(id) : undefined))
  handle('ocr:recognize', async (_e, image: unknown) => {
    if (!(image instanceof Uint8Array) || image.byteLength > 200 * 1024 * 1024) throw new Error('Invalid image')
    return recognize(image)
  })
  handle('spell:dictionary', async (_e, lang: unknown) => {
    if (typeof lang !== 'string' || !/^[a-z]{2,3}([-_][A-Z]{2})?$/.test(lang)) return null
    const name = lang.replace('-', '_')
    for (const dir of ['/usr/share/hunspell', '/usr/share/myspell', '/usr/share/myspell/dicts']) {
      try {
        const [aff, dic] = await Promise.all([fs.readFile(path.join(dir, `${name}.aff`), 'utf8'), fs.readFile(path.join(dir, `${name}.dic`), 'utf8')])
        return { aff, dic }
      } catch {
        /* try next */
      }
    }
    return null
  })
  handle('lo:available', () => lo.findSoffice() !== null)
  handle('lo:convert', (_e, data: unknown, from: unknown, to: unknown) => {
    if (!isBytes(data) || typeof from !== 'string' || typeof to !== 'string') throw new Error('Invalid arguments')
    return lo.convert(data, from, to)
  })

  handle('window:minimize', () => mainWindow?.minimize())
  handle('window:toggle-maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()))
  handle('window:close', () => mainWindow?.close())
  handle('window:titlebar-colors', (_e, c: { color: string; symbolColor: string }) => {
    if (isMac || !c || typeof c.color !== 'string' || typeof c.symbolColor !== 'string') return
    try {
      mainWindow?.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 44 })
    } catch {
      /* platform without overlay support */
    }
  })
  handle('shell:open-external', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) throw new Error('Blocked URL')
    await shell.openExternal(url)
  })
  handle('app:confirm-close', () => {
    allowClose = true
    mainWindow?.close()
  })
}

// ---------- lifecycle ----------
if (process.env.SIMPLE_DOCS_USER_DATA) app.setPath('userData', process.env.SIMPLE_DOCS_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    void sendOpenFiles(filesFromArgv(argv))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.on('open-file', (e, p) => {
    e.preventDefault()
    void sendOpenFiles([p])
  })

  app.whenReady().then(async () => {
    app.setName('Simple Docs')
    hardenSessions()
    registerIpc()
    buildMenu()
    pendingOpen.push(...filesFromArgv(process.argv))
    createWindow(await store.getSettings())
    app.on('activate', async () => {
      if (!mainWindow) createWindow(await store.getSettings())
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
  app.on('will-quit', () => void stopOcr())
}
