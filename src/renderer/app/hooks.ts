import { useEffect, useRef, useState } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useApp, editors, hfEditor } from '../state/store'
import { blockAttr, currentFont, currentFontSize, currentStyleId } from './commands'
import { paginationKey } from '@/layout/plugin'

export function useActiveEditor(): Editor | null {
  const active = useApp((s) => s.active)
  const hf = useApp((s) => s.hf)
  // Re-render when tabs change so a freshly created editor is picked up.
  useApp((s) => s.tabs.length)
  return (hf && hfEditor.current) || (editors.get(active) ?? null)
}

/** Body editor of the active tab (ignores an open header/footer editor). */
export function useBodyEditor(): Editor | null {
  const active = useApp((s) => s.active)
  useApp((s) => s.tabs.length)
  return editors.get(active) ?? null
}

export interface Snapshot {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  doubleStrike: boolean
  sub: boolean
  sup: boolean
  code: boolean
  link: boolean
  bullet: boolean
  ordered: boolean
  task: boolean
  quote: boolean
  codeBlock: boolean
  inTable: boolean
  image: boolean
  align: string
  lineHeight: number | null
  spaceBefore: number | null
  spaceAfter: number | null
  indentLeft: number | null
  indentRight: number | null
  indentFirst: number | null
  keepNext: boolean
  keepLines: boolean
  pageBreakBefore: boolean
  font: string
  size: number
  color: string | null
  highlight: string | null
  styleId: string
  canUndo: boolean
  canRedo: boolean
  empty: boolean
}

const EMPTY: Snapshot = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  doubleStrike: false,
  sub: false,
  sup: false,
  code: false,
  link: false,
  bullet: false,
  ordered: false,
  task: false,
  quote: false,
  codeBlock: false,
  inTable: false,
  image: false,
  align: 'left',
  lineHeight: null,
  spaceBefore: null,
  spaceAfter: null,
  indentLeft: null,
  indentRight: null,
  indentFirst: null,
  keepNext: false,
  keepLines: false,
  pageBreakBefore: false,
  font: 'Calibri',
  size: 11,
  color: null,
  highlight: null,
  styleId: 'Normal',
  canUndo: false,
  canRedo: false,
  empty: true
}

export function snapshot(e: Editor): Snapshot {
  return {
    bold: e.isActive('bold'),
    italic: e.isActive('italic'),
    underline: e.isActive('underline'),
    strike: e.isActive('strike'),
    doubleStrike: e.isActive('doubleStrike'),
    sub: e.isActive('subscript'),
    sup: e.isActive('superscript'),
    code: e.isActive('code'),
    link: e.isActive('link'),
    bullet: e.isActive('bulletList'),
    ordered: e.isActive('orderedList'),
    task: e.isActive('taskList'),
    quote: e.isActive('blockquote'),
    codeBlock: e.isActive('codeBlock'),
    inTable: e.isActive('table'),
    image: e.isActive('image'),
    align: blockAttr<string>(e, 'align') ?? 'left',
    lineHeight: blockAttr<number>(e, 'lineHeight'),
    spaceBefore: blockAttr<number>(e, 'spaceBefore'),
    spaceAfter: blockAttr<number>(e, 'spaceAfter'),
    indentLeft: blockAttr<number>(e, 'indentLeft'),
    indentRight: blockAttr<number>(e, 'indentRight'),
    indentFirst: blockAttr<number>(e, 'indentFirst'),
    keepNext: !!blockAttr(e, 'keepNext'),
    keepLines: !!blockAttr(e, 'keepLines'),
    pageBreakBefore: !!blockAttr(e, 'pageBreakBefore'),
    font: currentFont(e),
    size: currentFontSize(e),
    color: (e.getAttributes('textStyle').color as string) ?? null,
    highlight: (e.getAttributes('highlight').color as string) ?? null,
    styleId: currentStyleId(e),
    canUndo: e.can().undo(),
    canRedo: e.can().redo(),
    empty: e.state.selection.empty
  }
}

export function useSnapshot(editor: Editor | null): Snapshot {
  return useEditorState({ editor, selector: ({ editor: e }) => (e ? snapshot(e) : EMPTY) }) ?? EMPTY
}

export function usePageInfo(editor: Editor | null): { pages: number; current: number } {
  return (
    useEditorState({
      editor,
      selector: ({ editor: e }) => {
        if (!e) return { pages: 1, current: 1 }
        const st = paginationKey.getState(e.state)
        const head = e.state.selection.head
        const current = (st?.breaks.filter((b) => b.pos <= head).length ?? 0) + 1
        return { pages: st?.pageCount ?? 1, current }
      }
    }) ?? { pages: 1, current: 1 }
  )
}

export interface Stats {
  words: number
  chars: number
  charsNoSpaces: number
  paragraphs: number
}

const statsCache = new WeakMap<object, Stats>()

export function computeStats(e: Editor): Stats {
  const cached = statsCache.get(e.state.doc)
  if (cached) return cached
  const text = e.state.doc.textBetween(0, e.state.doc.content.size, '\n', ' ')
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
  let paragraphs = 0
  e.state.doc.descendants((n) => {
    if (n.isTextblock && n.textContent.trim()) paragraphs++
  })
  const stats = { words, chars: text.replace(/\n/g, '').length, charsNoSpaces: text.replace(/\s/g, '').length, paragraphs }
  statsCache.set(e.state.doc, stats)
  return stats
}

/** Like useEditorState, but recomputes at most every `ms` while the document changes (for O(n) derived data). */
export function useThrottled<T>(editor: Editor | null, compute: (e: Editor) => T, fallback: T, ms = 400): T {
  const [value, setValue] = useState<T>(() => (editor ? compute(editor) : fallback))
  const fn = useRef(compute)
  fn.current = compute
  useEffect(() => {
    if (!editor) return setValue(fallback)
    setValue(fn.current(editor))
    let timer = 0
    const onUpdate = () => {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        if (!editor.isDestroyed) setValue(fn.current(editor))
      }, ms)
    }
    editor.on('update', onUpdate)
    return () => {
      window.clearTimeout(timer)
      editor.off('update', onUpdate)
    }
  }, [editor, ms])
  return value
}

const NO_STATS: Stats = { words: 0, chars: 0, charsNoSpaces: 0, paragraphs: 0 }

export function useStats(editor: Editor | null): Stats {
  return useThrottled(editor, computeStats, NO_STATS)
}
