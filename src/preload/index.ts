import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { OpenedFile, SimpleDocsApi } from '../shared/ipc-types'

const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void) => {
  const listener = (_e: unknown, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: SimpleDocsApi = {
  platform: process.platform,
  openDialog: () => ipcRenderer.invoke('files:open-dialog'),
  readFile: (p) => ipcRenderer.invoke('files:read', p),
  saveDialog: (name, exts) => ipcRenderer.invoke('files:save-dialog', name, exts),
  writeFile: (p, data) => ipcRenderer.invoke('files:write', p, data),
  grantDroppedFile: (file) => {
    const p = webUtils.getPathForFile(file)
    if (!p) return null
    void ipcRenderer.invoke('files:grant-dropped', p)
    return p
  },
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentAdd: (entry) => ipcRenderer.invoke('recent:add', entry),
  recentUpdate: (p, patch) => ipcRenderer.invoke('recent:update', p, patch),
  recentRemove: (p) => ipcRenderer.invoke('recent:remove', p),
  recoveryWrite: (id, payload) => ipcRenderer.invoke('recovery:write', id, payload),
  recoveryList: () => ipcRenderer.invoke('recovery:list'),
  recoveryRemove: (id) => ipcRenderer.invoke('recovery:remove', id),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  exportPdf: (opts) => ipcRenderer.invoke('pdf:export', opts),
  print: () => ipcRenderer.invoke('print'),
  capturePage: (rect) => ipcRenderer.invoke('capture-page', rect),
  readAsset: (url) => ipcRenderer.invoke('asset:read', url),
  spellDictionary: (lang) => ipcRenderer.invoke('spell:dictionary', lang),
  ocr: (image) => ipcRenderer.invoke('ocr:recognize', image),
  libreOfficeAvailable: () => ipcRenderer.invoke('lo:available'),
  libreOfficeConvert: (data, from, to) => ipcRenderer.invoke('lo:convert', data, from, to),
  windowMinimize: () => void ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => void ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => void ipcRenderer.invoke('window:close'),
  setTitleBarColors: (c) => void ipcRenderer.invoke('window:titlebar-colors', c),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  onOpenFiles: (cb) => on<[OpenedFile[]]>('app:open-files', cb),
  onCloseRequest: (cb) => on('app:close-request', cb),
  onMenuCommand: (cb) => on<[string]>('app:menu-command', cb),
  confirmClose: () => void ipcRenderer.invoke('app:confirm-close')
}

contextBridge.exposeInMainWorld('simpleDocs', api)
