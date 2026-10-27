import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import { DEFAULT_SETTINGS, type OpenedFile, type RecentFile, type RecoveryEntry, type Settings } from '@/shared/ipc-types'
import type { FormatId, FormatWarning } from '@/formats/types'
import type { MergeData } from '@/editor/mailmerge'

export type RibbonTab = 'home' | 'insert' | 'layout' | 'references' | 'review' | 'view' | 'tools'
export type LeftPanel = 'outline' | 'pages' | 'recent'
export type RightPanel = 'format' | 'page' | 'stats' | 'comments' | 'a11y'
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

export interface TabMeta {
  id: string
  /** 'pdf' tabs open the PDF workspace instead of the word processor. */
  kind?: 'doc' | 'pdf'
  title: string
  path: string | null
  format: FormatId | null
  dirty: boolean
  status: SaveStatus
  warnings: FormatWarning[]
  /** Autosave to the file is paused until the user saves explicitly (e.g. after lossy import). */
  autosaveBlocked: boolean
  mode: 'rich' | 'source'
  savedAt: number | null
  error?: string
}

export type Dialog =
  | { kind: 'settings'; section?: string }
  | { kind: 'confirm-close'; tabIds: string[]; then?: 'quit' }
  | { kind: 'link' }
  | { kind: 'compat'; tabId: string }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  | { kind: 'stats' }
  | { kind: 'style'; styleId: string | null }
  | { kind: 'pdf-password'; file: OpenedFile; wrong: boolean }
  | { kind: 'history' }
  | { kind: 'sources'; insert: boolean }
  | { kind: 'equation'; pos?: number }
  | { kind: 'export-warnings'; tabId: string; format: FormatId; warnings: FormatWarning[]; resolve: (ok: boolean) => void }

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

export interface AppState {
  ready: boolean
  settings: Settings
  recents: RecentFile[]
  recovery: RecoveryEntry[]
  tabs: TabMeta[]
  active: string
  backstage: boolean
  ribbonTab: RibbonTab
  leftPanel: LeftPanel | null
  rightPanel: RightPanel | null
  zoom: number
  showMarks: boolean
  showBoundaries: boolean
  focusMode: boolean
  find: { open: boolean; replace: boolean }
  dialog: Dialog | null
  toasts: Toast[]
  painter: { marks: { type: string; attrs: Record<string, unknown> }[]; para: Record<string, unknown> | null } | null
  libreOffice: boolean
  dark: boolean
  /** Header/footer currently being edited in place. */
  hf: { tabId: string; kind: 'header' | 'footer'; page: number } | null
  /** Show tracked deletions and insertion styling (false = "final" view). */
  showMarkup: boolean
  /** Mail-merge data source and previewed record, per document tab (not saved). */
  merge: Record<string, { data: MergeData; preview: number | null }>
  /** Footnote/endnote being edited (document position of its reference). */
  note: { tabId: string; pos: number } | null
}

export const HOME = 'home'

export const useApp = create<AppState>(() => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  recents: [],
  recovery: [],
  tabs: [],
  active: HOME,
  backstage: false,
  ribbonTab: 'home',
  leftPanel: 'outline',
  rightPanel: null,
  zoom: 1,
  showMarks: false,
  showBoundaries: true,
  focusMode: false,
  find: { open: false, replace: false },
  dialog: null,
  toasts: [],
  painter: null,
  libreOffice: false,
  dark: false,
  hf: null,
  note: null,
  showMarkup: true,
  merge: {}
}))

export const set = useApp.setState
export const get = useApp.getState

/** Live editor instances, keyed by tab id (kept out of React state). */
export const editors = new Map<string, Editor>()
/** Format-specific data carried with a tab (e.g. original DOCX parts). */
export const carries = new Map<string, unknown>()

export interface PdfSession {
  /** Engine document id (changes when undo reopens a snapshot). */
  doc: number
  pages: { width: number; height: number; rotation: number }[]
  meta: { title: string; author: string; subject: string; keywords: string }
  /** Snapshots for undo (whole-file; most recent last). */
  undo: Uint8Array[]
}
export const pdfSessions = new Map<string, PdfSession>()

/** The in-place header/footer editor while one is open (ribbon commands target it). */
export const hfEditor: { current: Editor | null } = { current: null }

export function activeEditor(): Editor | null {
  return (get().hf && hfEditor.current) || (get().note && hfEditor.current) || (editors.get(get().active) ?? null)
}

/** The document's body editor, even while a header is being edited. */
export function bodyEditor(): Editor | null {
  return editors.get(get().active) ?? null
}

export function activeTab(): TabMeta | null {
  return get().tabs.find((t) => t.id === get().active) ?? null
}

export function updateTab(id: string, patch: Partial<TabMeta>) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
}

let toastSeq = 0
export function toast(message: string, kind: Toast['kind'] = 'info') {
  const id = ++toastSeq
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500)
}

export async function updateSettings(patch: Partial<Settings>) {
  set((s) => ({ settings: { ...s.settings, ...patch } }))
  const next = await window.simpleDocs.settingsSet(patch)
  set({ settings: next })
}
