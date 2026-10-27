import type { Editor, JSONContent } from '@tiptap/core'
import { createDocEditor, emptyDoc, normalizeDoc, type NewDocOptions } from '@/editor/create'
import { exportBytes, importBytes, type LibreOfficeBridge } from '@/formats/registry'
import { formatFromPath, type FormatId, type FormatWarning } from '@/formats/types'
import { printDocument, renderPdf } from '@/export/print'
import type { OpenedFile, RecoveryEntry } from '@/shared/ipc-types'
import { docScope } from '../app/DocumentView'
import { HOME, carries, editors, get, set, toast, updateTab, type TabMeta } from './store'

const api = () => window.simpleDocs

export const lo: LibreOfficeBridge = {
  available: () => api().libreOfficeAvailable(),
  convert: (d, f, t) => api().libreOfficeConvert(d, f, t)
}

let seq = 0
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
const EXT: Record<FormatId, string> = { docx: 'docx', odt: 'odt', rtf: 'rtf', doc: 'doc', md: 'md', html: 'html', txt: 'txt' }

function docOptions(): NewDocOptions {
  const s = get().settings
  return { font: s.defaultFont, fontSize: s.defaultFontSize, pageSize: s.defaultPageSize, margins: s.defaultMargins }
}

// ---------- dirty tracking, recovery, autosave ----------

const timers = new Map<string, { recovery?: number; autosave?: number }>()

function scheduleBackground(id: string) {
  const t = timers.get(id) ?? {}
  timers.set(id, t)
  const s = get().settings
  window.clearTimeout(t.recovery)
  t.recovery = window.setTimeout(() => void writeRecovery(id), s.recoveryIntervalSec * 1000)
  const tab = get().tabs.find((x) => x.id === id)
  if (s.autosave && tab?.path && tab.format && !tab.autosaveBlocked && tab.format !== 'doc') {
    window.clearTimeout(t.autosave)
    t.autosave = window.setTimeout(() => void autosave(id), s.autosaveIntervalSec * 1000)
  }
}

function clearTimers(id: string) {
  const t = timers.get(id)
  if (t) {
    window.clearTimeout(t.recovery)
    window.clearTimeout(t.autosave)
  }
  timers.delete(id)
}

async function writeRecovery(id: string) {
  const editor = editors.get(id)
  const tab = get().tabs.find((t) => t.id === id)
  if (!editor || !tab?.dirty) return
  try {
    await api().recoveryWrite(id, JSON.stringify({ title: tab.title, path: tab.path, format: tab.format, doc: editor.getJSON() }))
  } catch {
    /* recovery is best-effort; the next change retries */
  }
}

async function autosave(id: string) {
  const tab = get().tabs.find((t) => t.id === id)
  if (!tab?.dirty || !tab.path || !tab.format || tab.autosaveBlocked) return
  await save(id, { auto: true })
}

function markDirty(id: string) {
  const tab = get().tabs.find((t) => t.id === id)
  if (!tab) return
  if (!tab.dirty || tab.status !== 'unsaved') updateTab(id, { dirty: true, status: 'unsaved' })
  scheduleBackground(id)
}

// ---------- tabs ----------

function makeEditor(id: string, content: JSONContent, onRepair?: () => void): Editor {
  const opts = { content, placeholder: 'Start writing…', onDocFiles: (files: File[]) => void openDroppedFiles(files) }
  let editor: Editor
  try {
    editor = createDocEditor(opts)
  } catch {
    // Keep everything rather than refuse the file; ProseMirror tolerates the odd structure.
    editor = createDocEditor({ ...opts, strict: false })
    onRepair?.()
  }
  // Run schema fix-ups (trailing paragraph, table normalization) now, flagged so they don't count as edits.
  editor.view.dispatch(editor.state.tr.setMeta('pagination', true))
  // Pagination transactions (and fix-ups appended to them) are not user edits.
  editor.on('update', ({ transaction }) => {
    if (!transaction.getMeta('pagination')) markDirty(id)
  })
  editors.set(id, editor)
  return editor
}

function untitled(): string {
  const used = new Set(get().tabs.map((t) => t.title))
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Untitled' : `Untitled ${n}`
    if (!used.has(name)) return name
  }
}

function addTab(meta: Partial<TabMeta> & { id: string; title: string }) {
  const tab: TabMeta = { path: null, format: null, dirty: false, status: 'saved', warnings: [], autosaveBlocked: false, mode: 'rich', savedAt: null, ...meta }
  set((s) => ({ tabs: [...s.tabs, tab], active: tab.id, backstage: false }))
}

export function newDocument(content?: JSONContent, title?: string): string {
  const id = newId()
  const doc = content ? normalizeDoc(content, docOptions()) : emptyDoc(docOptions())
  makeEditor(id, doc)
  addTab({ id, title: title ?? untitled() })
  requestAnimationFrame(() => editors.get(id)?.commands.focus('start'))
  return id
}

export function activate(id: string) {
  set({ active: id, backstage: false })
  requestAnimationFrame(() => editors.get(id)?.commands.focus())
}

export async function openFiles(files: OpenedFile[]) {
  for (const f of files) {
    const existing = f.path ? get().tabs.find((t) => t.path === f.path) : null
    if (existing) {
      activate(existing.id)
      continue
    }
    const format = formatFromPath(f.name)
    if (!format) {
      toast(`${f.name}: unsupported file type`, 'error')
      continue
    }
    try {
      const r = await importBytes(format, f.data, lo)
      const id = newId()
      makeEditor(id, normalizeDoc(r.doc, docOptions()), () => r.warnings.push({ level: 'info', message: 'Some document structure did not match the editor’s rules and was kept as-is' }))
      if (r.carry) carries.set(id, r.carry)
      const loss = r.warnings.some((w) => w.level === 'loss')
      addTab({ id, title: baseName(f.name), path: f.path || null, format, warnings: r.warnings, autosaveBlocked: loss, savedAt: f.mtime })
      if (f.path) void addRecent(f.path, f.name)
      if (loss) toast(`Opened ${f.name} with compatibility notes — see the ⚠ badge`, 'info')
    } catch (e) {
      toast(`Could not open ${f.name}: ${(e as Error).message}`, 'error')
    }
  }
}

export async function openDialog() {
  try {
    await openFiles(await api().openDialog())
  } catch (e) {
    toast((e as Error).message, 'error')
  }
}

export async function openPath(path: string) {
  try {
    await openFiles([await api().readFile(path)])
  } catch (e) {
    toast(`Could not open ${baseName(path)}: ${(e as Error).message}`, 'error')
  }
}

export async function openDroppedFiles(files: File[]) {
  const opened: OpenedFile[] = []
  for (const file of files) {
    const path = api().grantDroppedFile(file)
    opened.push({ path: path ?? '', name: file.name, data: new Uint8Array(await file.arrayBuffer()), mtime: file.lastModified })
  }
  await openFiles(opened)
}

async function addRecent(path: string, name: string) {
  try {
    set({ recents: await api().recentAdd({ path, name, openedAt: Date.now() }) })
  } catch {
    /* non-critical */
  }
}

async function captureThumbnail(id: string, path: string) {
  await new Promise((r) => setTimeout(r, 50))
  const sheet = document.querySelector(`[data-doc-scroll="${id}"] .page-sheet`)
  if (!sheet) return
  const r = sheet.getBoundingClientRect()
  const visibleH = Math.min(r.height, window.innerHeight - r.top)
  if (r.width < 50 || visibleH < 80 || r.top < 0) return
  try {
    const thumbnail = await api().capturePage({ x: r.left, y: r.top, width: r.width, height: Math.min(visibleH, r.width * 1.294) })
    set({ recents: await api().recentUpdate(path, { thumbnail }) })
  } catch {
    /* non-critical */
  }
}

// ---------- save / export ----------

function confirmWarnings(tabId: string, format: FormatId, warnings: FormatWarning[]): Promise<boolean> {
  return new Promise((resolve) => set({ dialog: { kind: 'export-warnings', tabId, format, warnings, resolve } }))
}

export async function save(id = get().active, opts: { as?: boolean; format?: FormatId; auto?: boolean } = {}): Promise<boolean> {
  const tab = get().tabs.find((t) => t.id === id)
  const editor = editors.get(id)
  if (!tab || !editor) return false
  let path = tab.path
  let format: FormatId = opts.format ?? tab.format ?? get().settings.defaultSaveFormat
  if (format === 'doc') format = 'docx'
  const asNew = opts.as || !path || opts.format != null || tab.format === 'doc'
  if (asNew) {
    if (opts.auto) return false
    const others = (['docx', 'odt', 'rtf', 'md', 'html', 'txt'] as FormatId[]).filter((f) => f !== format)
    const chosen = await api().saveDialog(`${tab.title}.${EXT[format]}`, [EXT[format], ...others.map((f) => EXT[f])])
    if (!chosen) return false
    path = chosen
    format = formatFromPath(chosen) ?? format
    if (format === 'doc') {
      toast('Saving as .doc is not supported; choose DOCX.', 'error')
      return false
    }
  }
  try {
    updateTab(id, { status: 'saving' })
    const result = await exportBytes(format, editor.getJSON(), carries.get(id), lo)
    const losses = result.warnings.filter((w) => w.level === 'loss')
    if (losses.length && (asNew || format !== tab.format)) {
      if (!(await confirmWarnings(id, format, losses))) {
        updateTab(id, { status: tab.dirty ? 'unsaved' : 'saved' })
        return false
      }
    } else if (losses.length && opts.auto) {
      updateTab(id, { status: 'unsaved', autosaveBlocked: true })
      return false
    }
    await api().writeFile(path!, result.data)
    const title = baseName(path!)
    updateTab(id, { path, format, title, dirty: false, status: 'saved', savedAt: Date.now(), autosaveBlocked: false, error: undefined, warnings: format === tab.format ? tab.warnings : [] })
    clearTimers(id)
    void api().recoveryRemove(id)
    if (!opts.auto) {
      await addRecent(path!, `${title}.${EXT[format]}`)
      void captureThumbnail(id, path!)
    }
    return true
  } catch (e) {
    updateTab(id, { status: 'error', error: (e as Error).message })
    toast(`Save failed: ${(e as Error).message}`, 'error')
    return false
  }
}

export async function exportPdf(id = get().active) {
  const tab = get().tabs.find((t) => t.id === id)
  const editor = editors.get(id)
  if (!tab || !editor) return
  const path = await api().saveDialog(`${tab.title}.pdf`, ['pdf'])
  if (!path) return
  try {
    toast('Exporting PDF…')
    const bytes = await renderPdf(editor, docScope(id), tab.title)
    await api().writeFile(path, bytes)
    toast(`Exported ${baseName(path)}.pdf`, 'success')
  } catch (e) {
    toast(`PDF export failed: ${(e as Error).message}`, 'error')
  }
}

export async function print(id = get().active) {
  const tab = get().tabs.find((t) => t.id === id)
  const editor = editors.get(id)
  if (!tab || !editor) return
  try {
    await printDocument(editor, docScope(id), tab.title)
  } catch (e) {
    toast(`Printing failed: ${(e as Error).message}`, 'error')
  }
}

// ---------- closing ----------

export function closeTab(id: string, force = false) {
  const tab = get().tabs.find((t) => t.id === id)
  if (!tab) return
  if (tab.dirty && !force) {
    set({ dialog: { kind: 'confirm-close', tabIds: [id] } })
    return
  }
  clearTimers(id)
  void api().recoveryRemove(id)
  const tabs = get().tabs
  const idx = tabs.findIndex((t) => t.id === id)
  const rest = tabs.filter((t) => t.id !== id)
  const next = get().active === id ? (rest[idx] ?? rest[idx - 1])?.id ?? HOME : get().active
  set({ tabs: rest, active: next })
  // Destroy after React unmounts the view.
  requestAnimationFrame(() => {
    editors.get(id)?.destroy()
    editors.delete(id)
    carries.delete(id)
  })
}

export function requestQuit() {
  const dirty = get().tabs.filter((t) => t.dirty).map((t) => t.id)
  if (dirty.length) set({ dialog: { kind: 'confirm-close', tabIds: dirty, then: 'quit' } })
  else quitNow()
}

export function quitNow() {
  for (const t of get().tabs) void api().recoveryRemove(t.id)
  api().confirmClose()
}

// ---------- recovery ----------

export function restoreRecovery(entry: RecoveryEntry) {
  try {
    const data = JSON.parse(entry.payload) as { title: string; path: string | null; format: FormatId | null; doc: JSONContent }
    const id = newDocument(data.doc, `${data.title} (recovered)`)
    updateTab(id, { path: data.path, format: data.format, dirty: true, status: 'unsaved', autosaveBlocked: true })
    void writeRecovery(id)
  } catch {
    toast('That recovery file is damaged and could not be restored.', 'error')
  }
  void discardRecovery(entry.id)
}

export async function discardRecovery(id: string) {
  await api().recoveryRemove(id)
  set((s) => ({ recovery: s.recovery.filter((r) => r.id !== id) }))
}
