import { generateHTML, type Extensions, type JSONContent } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { createExtensions } from './extensions'
import { collectNotes, type NoteRef } from './notes'
import type { PageSetup } from './model'
import { ptToPx } from './model'
import type { Break } from '@/layout/breaks'

let ext: Extensions | null = null
const extensions = () => (ext ??= createExtensions())
const htmlCache = new WeakMap<object, string>()

export function noteHtml(note: NoteRef): string {
  let body = htmlCache.get(note.content)
  if (body === undefined) {
    body = note.content.length ? generateHTML({ type: 'doc', content: note.content as JSONContent[] }, extensions()) : '<p></p>'
    htmlCache.set(note.content, body)
  }
  return `<div class="sd-note" data-note-pos="${note.pos}"><span class="sd-note-n">${note.label}</span><div class="sd-note-body">${body}</div></div>`
}

/** Notes printed at the bottom of page `i`: its footnotes, plus all endnotes on the last page. */
export function notesForPage(notes: NoteRef[], breaks: Break[], i: number): NoteRef[] {
  const from = i === 0 ? 0 : breaks[i - 1].pos
  const to = i < breaks.length ? breaks[i].pos : Infinity
  const last = i === breaks.length
  return notes.filter((n) => (n.kind === 'footnote' ? n.pos >= from && n.pos < to : last))
}

export function notesAreaHtml(notes: NoteRef[]): string {
  if (!notes.length) return ''
  const foot = notes.filter((n) => n.kind === 'footnote')
  const end = notes.filter((n) => n.kind === 'endnote')
  return `<div class="sd-notes-sep"></div>${foot.map(noteHtml).join('')}${end.length ? `<div class="sd-endnotes-title">Endnotes</div>${end.map(noteHtml).join('')}` : ''}`
}

/** Height measurement shared by layout: renders the note off-screen at text width. */
export function makeNoteMeasurer() {
  const cache = new Map<string, number>()
  let el: HTMLDivElement | null = null
  return (view: EditorView, note: NoteRef): number => {
    const page = view.state.doc.attrs.page as PageSetup
    const width = ptToPx(page.width - page.margins.left - page.margins.right)
    const key = `${width}|${note.kind}|${JSON.stringify(note.content)}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const host = (view.dom as HTMLElement).parentElement
    if (!host) return 0
    if (!el || el.parentElement !== host) {
      el = document.createElement('div')
      el.className = 'sd-doc sd-notes sd-notes-measure'
      el.setAttribute('aria-hidden', 'true')
      host.appendChild(el)
    }
    el.style.width = `${width}px`
    el.innerHTML = noteHtml(note)
    const h = el.offsetHeight
    if (cache.size > 2000) cache.clear()
    cache.set(key, h)
    return h
  }
}

export { collectNotes }
