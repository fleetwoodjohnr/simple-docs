import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { activeEditor, activeTab, get, set, toast, updateSettings, HOME } from '../state/store'
import * as docs from '../state/documents'
import { readAsDataUrl } from '@/editor/create'
import { resolveStyle, type StyleMap } from '@/editor/model'

// Central command registry. Ribbon buttons, menus, the floating toolbar, the
// command palette and keyboard shortcuts all dispatch through here.

export interface Command {
  id: string
  label: string
  /** ProseMirror-style key: Mod-b, Mod-Shift-s, Mod-Enter, Alt-F4 … */
  shortcut?: string
  /** Runs even while focus is in an input field. */
  global?: boolean
  run: (editor: Editor | null) => unknown
  isActive?: (editor: Editor) => boolean
  needsEditor?: boolean
}

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

const commands = new Map<string, Command>()
const def = (c: Command) => commands.set(c.id, { needsEditor: true, ...c })

export const getCommand = (id: string) => commands.get(id)
export const allCommands = () => [...commands.values()]

export function runCommand(id: string) {
  const c = commands.get(id)
  if (!c) return
  const ed = activeEditor()
  if (c.needsEditor && !ed) return
  try {
    const r = c.run(ed)
    if (r instanceof Promise) r.catch((e: Error) => toast(e.message, 'error'))
  } catch (e) {
    toast((e as Error).message, 'error')
  }
}

export function shortcutFor(id: string): string | undefined {
  return get().settings.shortcuts[id] ?? commands.get(id)?.shortcut
}

export function formatShortcut(s: string | undefined): string {
  if (!s) return ''
  return s
    .split('-')
    .map((k) => {
      if (k === 'Mod') return isMac ? '⌘' : 'Ctrl'
      if (k === 'Shift') return isMac ? '⇧' : 'Shift'
      if (k === 'Alt') return isMac ? '⌥' : 'Alt'
      if (k === 'Ctrl') return isMac ? '⌃' : 'Ctrl'
      if (k === 'Enter') return isMac ? '↩' : 'Enter'
      if (k === 'Space') return 'Space'
      return k.length === 1 ? k.toUpperCase() : k
    })
    .join(isMac ? '' : '+')
}

/** Normalize a keyboard event to the registry's key format. */
export function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = []
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod) parts.push('Mod')
  if (isMac && e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  let key = e.key
  // Use the physical key for letters/digits with modifiers so Shift/Alt/layouts don't change it.
  if ((mod || e.altKey) && /^(Key[A-Z]|Digit\d)$/.test(e.code)) key = e.code.replace(/^(Key|Digit)/, '').toLowerCase()
  else if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toLowerCase()
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key)
  if (e.shiftKey && !symbol) parts.push('Shift')
  parts.push(key)
  return parts.join('-')
}

// ---------- editor helpers ----------

const chain = (e: Editor) => e.chain().focus()
const blockTypes = ['paragraph', 'heading']

export function updateBlocks(e: Editor, attrs: Record<string, unknown>) {
  return chain(e).updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).run()
}

/** Current paragraph attribute (from the first selected textblock). */
export function blockAttr<T = unknown>(e: Editor, key: string): T | null {
  const node = e.state.selection.$from.parent
  return blockTypes.includes(node.type.name) ? ((node.attrs[key] as T) ?? null) : null
}

export function currentStyleId(e: Editor): string {
  const n = e.state.selection.$from.parent
  if (n.type.name === 'heading') return (n.attrs.styleId as string) ?? `Heading${n.attrs.level}`
  if (n.type.name === 'paragraph') return (n.attrs.styleId as string) ?? 'Normal'
  return 'Normal'
}

export function applyStyle(e: Editor, id: string) {
  const styles = (e.state.doc.attrs.styles ?? {}) as StyleMap
  const s = styles[id]
  const h = /^Heading([1-9])$/.exec(id)
  const level = h ? Number(h[1]) : s?.outline
  if (level) return chain(e).setNode('heading', { level, styleId: h ? null : id }).run()
  return chain(e).setNode('paragraph', { styleId: id === 'Normal' ? null : id }).run()
}

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]

/** Effective font size (pt) at the selection: run mark or paragraph style. */
export function currentFontSize(e: Editor): number {
  const fs = e.getAttributes('textStyle').fontSize as string | undefined
  if (fs) return parseFloat(fs)
  const styles = (e.state.doc.attrs.styles ?? {}) as StyleMap
  return resolveStyle(styles, currentStyleId(e)).run.fontSize ?? 11
}

export function currentFont(e: Editor): string {
  const ff = e.getAttributes('textStyle').fontFamily as string | undefined
  if (ff) return ff.replace(/["']/g, '').split(',')[0].trim()
  const styles = (e.state.doc.attrs.styles ?? {}) as StyleMap
  return resolveStyle(styles, currentStyleId(e)).run.fontFamily ?? 'Calibri'
}

function stepFont(e: Editor, dir: 1 | -1) {
  const cur = currentFontSize(e)
  const next = dir > 0 ? FONT_SIZES.find((s) => s > cur) ?? cur + 12 : [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1)
  chain(e).setFontSize(`${next}pt`).run()
}

type CaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'toggle'

export function changeCase(e: Editor, mode: CaseMode) {
  const { from, to } = e.state.selection
  if (from === to) return
  const full = e.state.doc.textBetween(from, to, '\n', '\n')
  let out = ''
  let startOfSentence = true
  let startOfWord = true
  for (const ch of full) {
    let c = ch
    const lower = ch.toLowerCase()
    const upper = ch.toUpperCase()
    if (mode === 'upper') c = upper
    else if (mode === 'lower') c = lower
    else if (mode === 'toggle') c = ch === lower ? upper : lower
    else if (mode === 'title') c = startOfWord ? upper : lower
    else if (mode === 'sentence') c = startOfSentence && /\p{L}/u.test(ch) ? upper : lower
    if (c.length !== ch.length) c = ch
    out += c
    if (/\p{L}|\p{N}/u.test(ch)) {
      startOfWord = false
      startOfSentence = false
    } else {
      startOfWord = /\s|[-–—/(]/.test(ch)
      if (/[.!?\n]/.test(ch)) startOfSentence = true
    }
  }
  // Replace text node by node so marks survive.
  const tr = e.state.tr
  let offset = 0
  e.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const s = Math.max(from, pos)
      const end = Math.min(to, pos + node.nodeSize)
      const before = e.state.doc.textBetween(from, s, '\n', '\n').length
      offset = before
      const piece = out.slice(offset, offset + (end - s))
      if (piece && piece !== node.text!.slice(s - pos, end - pos)) tr.replaceWith(tr.mapping.map(s), tr.mapping.map(end), e.state.schema.text(piece, node.marks))
    }
  })
  tr.setSelection(TextSelection.create(tr.doc, from, to))
  e.view.dispatch(tr)
}

function indent(e: Editor, dir: 1 | -1) {
  if (e.isActive('listItem')) return dir > 0 ? chain(e).sinkListItem('listItem').run() : chain(e).liftListItem('listItem').run()
  if (e.isActive('taskItem')) return dir > 0 ? chain(e).sinkListItem('taskItem').run() : chain(e).liftListItem('taskItem').run()
  const cur = blockAttr<number>(e, 'indentLeft') ?? 0
  return updateBlocks(e, { indentLeft: Math.max(0, cur + dir * 36) || null })
}

export function insertImageFromPicker(e: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    chain(e)
      .setImage({ src: await readAsDataUrl(f), alt: f.name.replace(/\.[^.]+$/, '') })
      .run()
  }
  input.click()
}

function capturePainter(e: Editor) {
  const marks = e.state.selection.$from.marks().map((m) => ({ type: m.type.name, attrs: { ...m.attrs } }))
  const p = e.state.selection.$from.parent
  set({ painter: { marks, para: blockTypes.includes(p.type.name) ? { ...p.attrs } : null } })
  toast('Format painter: select text to apply formatting')
}

export function applyPainter(e: Editor) {
  const p = get().painter
  if (!p) return
  const { from, to, empty } = e.state.selection
  if (empty) return
  let c = e.chain().unsetAllMarks()
  for (const m of p.marks) if (m.type !== 'link') c = c.setMark(m.type, m.attrs)
  c.run()
  if (p.para) {
    const { level: _l, ...attrs } = p.para
    e.chain().updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).setTextSelection({ from, to }).run()
  }
  set({ painter: null })
}

export const SYMBOLS = '©®™§¶†‡•…–—‘’“”«»‹›°±×÷≠≈≤≥∞√∑∏∫∂µπΩαβγδεθλσφψω€£¥¢¤←→↑↓↔⇒⇔✓✗★☆♠♣♥♦½¼¾⅓⅔¹²³ⁿ∈∉∩∪⊂⊃∀∃∅∇'.split('')

export function zoomTo(z: number) {
  set({ zoom: Math.round(Math.min(5, Math.max(0.25, z)) * 100) / 100 })
}

// ---------- definitions ----------

// File
def({ id: 'file.new', label: 'New document', shortcut: 'Mod-n', global: true, needsEditor: false, run: () => docs.newDocument() })
def({ id: 'file.open', label: 'Open…', shortcut: 'Mod-o', global: true, needsEditor: false, run: () => docs.openDialog() })
def({ id: 'file.save', label: 'Save', shortcut: 'Mod-s', global: true, run: () => docs.save() })
def({ id: 'file.saveAs', label: 'Save as…', shortcut: 'Mod-Shift-s', global: true, run: () => docs.save(undefined, { as: true }) })
def({ id: 'file.exportPdf', label: 'Export as PDF…', shortcut: 'Mod-Shift-e', global: true, run: () => docs.exportPdf() })
def({ id: 'file.print', label: 'Print…', shortcut: 'Mod-p', global: true, run: () => docs.print() })
def({ id: 'file.close', label: 'Close document', shortcut: 'Mod-w', global: true, needsEditor: false, run: () => (get().active !== HOME ? docs.closeTab(get().active) : undefined) })
def({ id: 'file.home', label: 'Home', needsEditor: false, global: true, run: () => set({ active: HOME, backstage: false }) })
def({ id: 'file.backstage', label: 'File', needsEditor: false, run: () => set((s) => ({ backstage: !s.backstage })) })
def({ id: 'tab.next', label: 'Next tab', shortcut: isMac ? 'Ctrl-Tab' : 'Mod-Tab', global: true, needsEditor: false, run: () => cycleTab(1) })
def({ id: 'tab.prev', label: 'Previous tab', shortcut: isMac ? 'Ctrl-Shift-Tab' : 'Mod-Shift-Tab', global: true, needsEditor: false, run: () => cycleTab(-1) })

function cycleTab(dir: 1 | -1) {
  const ids = [HOME, ...get().tabs.map((t) => t.id)]
  const i = ids.indexOf(get().active)
  const next = ids[(i + dir + ids.length) % ids.length]
  if (next === HOME) set({ active: HOME })
  else docs.activate(next)
}

// Edit
def({ id: 'edit.undo', label: 'Undo', shortcut: 'Mod-z', run: (e) => chain(e!).undo().run() })
def({ id: 'edit.redo', label: 'Redo', shortcut: isMac ? 'Mod-Shift-z' : 'Mod-y', run: (e) => chain(e!).redo().run() })
def({ id: 'edit.redoAlt', label: 'Redo', shortcut: isMac ? 'Mod-y' : 'Mod-Shift-z', run: (e) => chain(e!).redo().run() })
def({ id: 'edit.cut', label: 'Cut', run: (e) => (e!.commands.focus(), document.execCommand('cut')) })
def({ id: 'edit.copy', label: 'Copy', run: (e) => (e!.commands.focus(), document.execCommand('copy')) })
def({
  id: 'edit.paste',
  label: 'Paste',
  run: async (e) => {
    e!.commands.focus()
    const items = await navigator.clipboard.read()
    for (const item of items) {
      if (item.types.includes('text/html')) return e!.view.pasteHTML(await (await item.getType('text/html')).text())
      const img = item.types.find((t) => t.startsWith('image/'))
      if (img) return chain(e!).setImage({ src: await readAsDataUrl(await item.getType(img)) }).run()
      if (item.types.includes('text/plain')) return e!.view.pasteText(await (await item.getType('text/plain')).text())
    }
  }
})
def({ id: 'edit.pastePlain', label: 'Paste as plain text', shortcut: 'Mod-Shift-v', run: async (e) => (e!.commands.focus(), e!.view.pasteText(await navigator.clipboard.readText())) })
def({ id: 'edit.selectAll', label: 'Select all', run: (e) => chain(e!).selectAll().run() })
def({ id: 'edit.find', label: 'Find', shortcut: 'Mod-f', run: () => set({ find: { open: true, replace: false } }) })
def({ id: 'edit.replace', label: 'Replace', shortcut: 'Mod-h', run: () => set({ find: { open: true, replace: true } }) })

// Character formatting
def({ id: 'fmt.bold', label: 'Bold', shortcut: 'Mod-b', run: (e) => chain(e!).toggleBold().run(), isActive: (e) => e.isActive('bold') })
def({ id: 'fmt.italic', label: 'Italic', shortcut: 'Mod-i', run: (e) => chain(e!).toggleItalic().run(), isActive: (e) => e.isActive('italic') })
def({ id: 'fmt.underline', label: 'Underline', shortcut: 'Mod-u', run: (e) => chain(e!).toggleUnderline().run(), isActive: (e) => e.isActive('underline') })
def({ id: 'fmt.strike', label: 'Strikethrough', shortcut: 'Mod-Shift-x', run: (e) => chain(e!).toggleStrike().run(), isActive: (e) => e.isActive('strike') })
def({ id: 'fmt.doubleStrike', label: 'Double strikethrough', run: (e) => chain(e!).toggleMark('doubleStrike').run(), isActive: (e) => e.isActive('doubleStrike') })
def({ id: 'fmt.subscript', label: 'Subscript', shortcut: 'Mod-,', run: (e) => chain(e!).unsetSuperscript().toggleSubscript().run(), isActive: (e) => e.isActive('subscript') })
def({ id: 'fmt.superscript', label: 'Superscript', shortcut: 'Mod-.', run: (e) => chain(e!).unsetSubscript().toggleSuperscript().run(), isActive: (e) => e.isActive('superscript') })
def({ id: 'fmt.code', label: 'Inline code', run: (e) => chain(e!).toggleCode().run(), isActive: (e) => e.isActive('code') })
def({ id: 'fmt.clear', label: 'Clear formatting', shortcut: 'Mod-Space', run: (e) => chain(e!).unsetAllMarks().run() && updateBlocks(e!, { align: null, lineHeight: null, spaceBefore: null, spaceAfter: null, indentLeft: null, indentRight: null, indentFirst: null, shading: null }) })
def({ id: 'fmt.grow', label: 'Increase font size', shortcut: 'Mod-]', run: (e) => stepFont(e!, 1) })
def({ id: 'fmt.shrink', label: 'Decrease font size', shortcut: 'Mod-[', run: (e) => stepFont(e!, -1) })
def({ id: 'fmt.caps', label: 'All caps', run: (e) => chain(e!).setMark('textStyle', { caps: !e!.getAttributes('textStyle').caps || null }).run(), isActive: (e) => !!e.getAttributes('textStyle').caps })
def({ id: 'fmt.smallCaps', label: 'Small caps', run: (e) => chain(e!).setMark('textStyle', { smallCaps: !e!.getAttributes('textStyle').smallCaps || null }).run(), isActive: (e) => !!e.getAttributes('textStyle').smallCaps })
def({ id: 'fmt.painter', label: 'Format painter', shortcut: 'Mod-Shift-c', run: (e) => (get().painter ? set({ painter: null }) : capturePainter(e!)), isActive: () => !!get().painter })
def({ id: 'case.upper', label: 'UPPERCASE', run: (e) => changeCase(e!, 'upper') })
def({ id: 'case.lower', label: 'lowercase', run: (e) => changeCase(e!, 'lower') })
def({ id: 'case.title', label: 'Capitalize Each Word', run: (e) => changeCase(e!, 'title') })
def({ id: 'case.sentence', label: 'Sentence case', run: (e) => changeCase(e!, 'sentence') })
def({ id: 'case.toggle', label: 'tOGGLE cASE', shortcut: 'Shift-F3', run: (e) => changeCase(e!, 'toggle') })

// Paragraph
for (const [id, align, key] of [
  ['para.left', 'left', 'Mod-l'],
  ['para.center', 'center', 'Mod-e'],
  ['para.right', 'right', 'Mod-r'],
  ['para.justify', 'justify', 'Mod-j']
] as const) {
  def({
    id,
    label: { left: 'Align left', center: 'Center', right: 'Align right', justify: 'Justify' }[align],
    shortcut: key,
    run: (e) => updateBlocks(e!, { align: blockAttr(e!, 'align') === align && align !== 'left' ? null : align }),
    isActive: (e) => (blockAttr(e, 'align') ?? 'left') === align
  })
}
def({ id: 'list.bullet', label: 'Bulleted list', shortcut: 'Mod-Shift-8', run: (e) => chain(e!).toggleBulletList().run(), isActive: (e) => e.isActive('bulletList') })
def({ id: 'list.ordered', label: 'Numbered list', shortcut: 'Mod-Shift-7', run: (e) => chain(e!).toggleOrderedList().run(), isActive: (e) => e.isActive('orderedList') })
def({ id: 'list.task', label: 'Checklist', shortcut: 'Mod-Shift-9', run: (e) => chain(e!).toggleTaskList().run(), isActive: (e) => e.isActive('taskList') })
def({ id: 'para.indent', label: 'Increase indent', shortcut: 'Mod-Alt-]', run: (e) => indent(e!, 1) })
def({ id: 'para.outdent', label: 'Decrease indent', shortcut: 'Mod-Alt-[', run: (e) => indent(e!, -1) })
def({ id: 'para.keepNext', label: 'Keep with next', run: (e) => updateBlocks(e!, { keepNext: !blockAttr(e!, 'keepNext') }), isActive: (e) => !!blockAttr(e, 'keepNext') })
def({ id: 'para.keepLines', label: 'Keep lines together', run: (e) => updateBlocks(e!, { keepLines: !blockAttr(e!, 'keepLines') }), isActive: (e) => !!blockAttr(e, 'keepLines') })
def({ id: 'para.pageBreakBefore', label: 'Page break before', run: (e) => updateBlocks(e!, { pageBreakBefore: !blockAttr(e!, 'pageBreakBefore') }), isActive: (e) => !!blockAttr(e, 'pageBreakBefore') })
def({ id: 'para.rtl', label: 'Right-to-left text', run: (e) => updateBlocks(e!, { dir: blockAttr(e!, 'dir') === 'rtl' ? null : 'rtl' }), isActive: (e) => blockAttr(e, 'dir') === 'rtl' })

// Styles
def({ id: 'style.normal', label: 'Normal text', shortcut: 'Mod-Alt-0', run: (e) => applyStyle(e!, 'Normal') })
for (let i = 1; i <= 6; i++) def({ id: `style.h${i}`, label: `Heading ${i}`, shortcut: i <= 3 ? `Mod-Alt-${i}` : undefined, run: (e) => applyStyle(e!, `Heading${i}`) })
def({ id: 'style.title', label: 'Title', run: (e) => applyStyle(e!, 'Title') })
def({ id: 'style.subtitle', label: 'Subtitle', run: (e) => applyStyle(e!, 'Subtitle') })
def({ id: 'style.quote', label: 'Quote', run: (e) => applyStyle(e!, 'Quote') })

// Insert
def({ id: 'insert.pageBreak', label: 'Page break', shortcut: 'Mod-Enter', run: (e) => chain(e!).setPageBreak().run() })
def({ id: 'insert.link', label: 'Link…', shortcut: 'Mod-k', run: () => set({ dialog: { kind: 'link' } }) })
def({ id: 'insert.image', label: 'Image…', run: (e) => insertImageFromPicker(e!) })
def({ id: 'insert.table', label: 'Table', run: (e) => chain(e!).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() })
def({ id: 'insert.hr', label: 'Horizontal line', run: (e) => chain(e!).setHorizontalRule().run() })
def({ id: 'insert.codeBlock', label: 'Code block', run: (e) => chain(e!).toggleCodeBlock().run(), isActive: (e) => e.isActive('codeBlock') })
def({ id: 'insert.quote', label: 'Block quote', run: (e) => chain(e!).toggleBlockquote().run(), isActive: (e) => e.isActive('blockquote') })
def({ id: 'insert.date', label: 'Date', run: (e) => chain(e!).insertContent(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })).run() })
def({ id: 'insert.lineBreak', label: 'Line break', shortcut: 'Shift-Enter', run: (e) => chain(e!).setHardBreak().run() })

// Table
def({ id: 'table.addRowAfter', label: 'Insert row below', run: (e) => chain(e!).addRowAfter().run() })
def({ id: 'table.addRowBefore', label: 'Insert row above', run: (e) => chain(e!).addRowBefore().run() })
def({ id: 'table.addColAfter', label: 'Insert column right', run: (e) => chain(e!).addColumnAfter().run() })
def({ id: 'table.addColBefore', label: 'Insert column left', run: (e) => chain(e!).addColumnBefore().run() })
def({ id: 'table.deleteRow', label: 'Delete row', run: (e) => chain(e!).deleteRow().run() })
def({ id: 'table.deleteCol', label: 'Delete column', run: (e) => chain(e!).deleteColumn().run() })
def({ id: 'table.delete', label: 'Delete table', run: (e) => chain(e!).deleteTable().run() })
def({ id: 'table.merge', label: 'Merge cells', run: (e) => chain(e!).mergeCells().run() })
def({ id: 'table.split', label: 'Split cell', run: (e) => chain(e!).splitCell().run() })
def({ id: 'table.headerRow', label: 'Header row', run: (e) => chain(e!).toggleHeaderRow().run() })

// View
def({ id: 'view.zoomIn', label: 'Zoom in', shortcut: 'Mod-=', global: true, needsEditor: false, run: () => zoomTo(get().zoom + 0.1) })
def({ id: 'view.zoomOut', label: 'Zoom out', shortcut: 'Mod--', global: true, needsEditor: false, run: () => zoomTo(get().zoom - 0.1) })
def({ id: 'view.zoomReset', label: 'Actual size', shortcut: 'Mod-0', global: true, needsEditor: false, run: () => zoomTo(1) })
def({ id: 'view.marks', label: 'Show formatting marks', shortcut: 'Mod-Shift-p', needsEditor: false, run: () => set((s) => ({ showMarks: !s.showMarks })), isActive: () => get().showMarks })
def({ id: 'view.boundaries', label: 'Show margin guides', needsEditor: false, run: () => set((s) => ({ showBoundaries: !s.showBoundaries })), isActive: () => get().showBoundaries })
def({ id: 'view.focus', label: 'Focus mode', shortcut: 'F11', global: true, needsEditor: false, run: () => set((s) => ({ focusMode: !s.focusMode })), isActive: () => get().focusMode })
def({ id: 'view.outline', label: 'Navigation pane', shortcut: 'Mod-Shift-o', needsEditor: false, run: () => set((s) => ({ leftPanel: s.leftPanel ? null : 'outline' })), isActive: () => !!get().leftPanel })
def({ id: 'view.inspector', label: 'Format panel', shortcut: 'Mod-Shift-i', needsEditor: false, run: () => set((s) => ({ rightPanel: s.rightPanel ? null : 'format' })), isActive: () => !!get().rightPanel })
def({ id: 'view.ribbon', label: 'Collapse ribbon', shortcut: 'Mod-F1', global: true, needsEditor: false, run: () => updateSettings({ ribbonCollapsed: !get().settings.ribbonCollapsed }), isActive: () => get().settings.ribbonCollapsed })
def({ id: 'view.theme', label: 'Toggle dark mode', needsEditor: false, global: true, run: () => updateSettings({ theme: get().dark ? 'light' : 'dark' }) })
def({ id: 'view.ruler', label: 'Ruler', needsEditor: false, run: () => updateSettings({ showRuler: !get().settings.showRuler }), isActive: () => get().settings.showRuler })
def({ id: 'view.source', label: 'Markdown source', shortcut: 'Mod-Alt-m', run: () => toggleSource(), isActive: () => activeTab()?.mode === 'source' })

function toggleSource() {
  const t = activeTab()
  if (!t) return
  set((s) => ({ tabs: s.tabs.map((x) => (x.id === t.id ? { ...x, mode: x.mode === 'source' ? 'rich' : 'source' } : x)) }))
}

// Tools
def({ id: 'tools.stats', label: 'Word count', shortcut: 'Mod-Shift-g', run: () => set({ dialog: { kind: 'stats' } }) })
def({ id: 'tools.settings', label: 'Settings', shortcut: isMac ? 'Mod-,' : 'Mod-Alt-s', global: true, needsEditor: false, run: () => set({ dialog: { kind: 'settings' } }) })
def({ id: 'tools.shortcuts', label: 'Keyboard shortcuts', shortcut: 'Mod-/', global: true, needsEditor: false, run: () => set({ dialog: { kind: 'shortcuts' } }) })
def({ id: 'tools.compat', label: 'Compatibility report', run: () => set({ dialog: { kind: 'compat', tabId: get().active } }) })
def({ id: 'tools.speak', label: 'Read aloud', run: (e) => speak(e!) })

function speak(e: Editor) {
  if (speechSynthesis.speaking) return speechSynthesis.cancel()
  const { from, to, empty } = e.state.selection
  const text = empty ? e.state.doc.textBetween(from, e.state.doc.content.size, '\n') : e.state.doc.textBetween(from, to, '\n')
  if (!speechSynthesis.getVoices().length) toast('No speech voices are installed on this system', 'error')
  speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 20000)))
}

if (isMac) {
  // macOS: Cmd-, is the settings convention, so sub/superscript move.
  commands.get('fmt.subscript')!.shortcut = 'Mod-Ctrl-,'
  commands.get('fmt.superscript')!.shortcut = 'Mod-Ctrl-.'
}

/** Keydown handler installed at window level (capture), so registry shortcuts win. */
export function handleKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  const combo = eventToShortcut(e)
  const target = e.target as HTMLElement | null
  const inField = !!target?.closest('input, textarea, select, .cm-editor, [role=dialog]') && !target?.closest('.sd-doc')
  for (const c of commands.values()) {
    if (shortcutFor(c.id) !== combo) continue
    if (inField && !c.global) return
    if (c.needsEditor && !activeEditor()) return
    if (c.id === 'insert.lineBreak') return // handled natively by the editor
    e.preventDefault()
    e.stopPropagation()
    runCommand(c.id)
    return
  }
}
