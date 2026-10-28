// Contract between the main process and the renderer. The preload script exposes
// `window.simpleDocs` implementing `SimpleDocsApi`; main validates every argument.

export interface OpenedFile {
  path: string
  name: string
  data: Uint8Array
  mtime: number
}

export interface RecentFile {
  path: string
  name: string
  openedAt: number
  pinned?: boolean
  favorite?: boolean
  thumbnail?: string
}

export interface RecoveryEntry {
  id: string
  savedAt: number
  /** JSON produced by the renderer (document + tab metadata). */
  payload: string
}

export type ThemeSetting = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemeSetting
  accent: string
  defaultFont: string
  defaultFontSize: number
  defaultPageSize: 'letter' | 'a4' | 'legal' | 'a3'
  defaultMargins: 'normal' | 'narrow' | 'moderate' | 'wide'
  defaultSaveFormat: 'docx' | 'odt' | 'md' | 'html' | 'txt'
  autosave: boolean
  autosaveIntervalSec: number
  recoveryIntervalSec: number
  spellcheck: boolean
  language: string
  authorName: string
  showRuler: boolean
  ribbonCollapsed: boolean
  reduceMotion: boolean
  uiScale: number
  shortcuts: Record<string, string>
  quickAccess: string[]
  customWords: string[]
  /** Optional AI writing assistant; off unless the user turns it on. */
  aiEnabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#5b5bd6',
  defaultFont: 'Calibri',
  defaultFontSize: 11,
  defaultPageSize: 'letter',
  defaultMargins: 'normal',
  defaultSaveFormat: 'docx',
  autosave: true,
  autosaveIntervalSec: 30,
  recoveryIntervalSec: 5,
  spellcheck: true,
  language: 'en-US',
  authorName: '',
  showRuler: true,
  ribbonCollapsed: false,
  reduceMotion: false,
  uiScale: 1,
  shortcuts: {},
  quickAccess: ['file.save', 'edit.undo', 'edit.redo'],
  customWords: [],
  aiEnabled: false
}

export interface PdfOptions {
  title?: string
}

export interface SimpleDocsApi {
  platform: 'darwin' | 'win32' | 'linux' | string
  /** Native open dialog; `filter` replaces the default document filter (single selection). */
  openDialog(filter?: { name: string; extensions: string[] }): Promise<OpenedFile[]>
  readFile(path: string): Promise<OpenedFile>
  saveDialog(defaultName: string, extensions: string[]): Promise<string | null>
  writeFile(path: string, data: Uint8Array): Promise<{ mtime: number }>
  /** Resolve a dropped File to its path and grant access to it. */
  grantDroppedFile(file: File): string | null

  recentList(): Promise<RecentFile[]>
  recentAdd(entry: RecentFile): Promise<RecentFile[]>
  recentUpdate(path: string, patch: Partial<RecentFile>): Promise<RecentFile[]>
  recentRemove(path: string): Promise<RecentFile[]>

  recoveryWrite(id: string, payload: string): Promise<void>
  recoveryList(): Promise<RecoveryEntry[]>
  recoveryRemove(id: string): Promise<void>

  /** Version history, keyed by document path. `auto` versions are kept at most every 10 minutes. */
  historyAdd(docPath: string, json: string, auto: boolean): Promise<boolean>
  historyList(docPath: string): Promise<{ id: string; savedAt: number; bytes: number }[]>
  historyRead(docPath: string, id: string): Promise<string>

  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>

  exportPdf(options: PdfOptions): Promise<Uint8Array>
  print(): Promise<boolean>
  /** A 256 px wide PNG of that part of the window, or null when nothing could be captured. */
  capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | null>

  /** Read a bundled renderer asset (file:// URL inside the app) — used for the PDFium WASM binary. */
  readAsset(url: string): Promise<Uint8Array>

  /** Recognize words in an encoded page image with the bundled offline OCR engine. Pixel boxes: left, top, right, bottom. */
  ocr(image: Uint8Array): Promise<{ text: string; confidence: number; bbox: [number, number, number, number] }[]>

  /** Hunspell dictionary installed on the system for a language (Linux), or null. */
  spellDictionary(lang: string): Promise<{ aff: string; dic: string } | null>

  libreOfficeAvailable(): Promise<boolean>
  libreOfficeConvert(data: Uint8Array, fromExt: string, toExt: string): Promise<Uint8Array>

  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  setTitleBarColors(colors: { color: string; symbolColor: string }): void
  openExternal(url: string): Promise<void>

  /** AI assistant (Claude API). Requests are refused unless Settings → AI assistant is on. */
  aiStatus(): Promise<{ hasStoredKey: boolean; envCredentials: boolean; weakStorage: boolean }>
  aiSetKey(key: string | null): Promise<void>
  aiRun(id: string, action: string, instruction: string, text: string): Promise<string>
  aiCancel(id: string): Promise<void>
  onAiText(cb: (id: string, delta: string) => void): () => void

  onOpenFiles(cb: (files: OpenedFile[]) => void): () => void
  onCloseRequest(cb: () => void): () => void
  onMenuCommand(cb: (id: string) => void): () => void
  confirmClose(): void
}
