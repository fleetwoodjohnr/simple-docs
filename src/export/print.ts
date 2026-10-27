import type { Editor } from '@tiptap/core'
import { pageOf, paginationKey } from '@/layout/plugin'
import { ptToPx } from '@/editor/model'
import { renderHF } from '@/editor/headers'

// Builds fixed-size print pages by slicing the live, paginated editor DOM at the
// page spacers. Range.cloneContents keeps partially selected ancestors (lists,
// tables), so every page reproduces exactly what the editor shows. Printing and
// PDF export render this root through `@media print`.

const TEXTBLOCK = /^(P|H[1-6])$/

function chainFirst(el: Node): Element[] {
  const out: Element[] = []
  let c = (el as Element).firstElementChild
  while (c) {
    out.push(c)
    c = c.firstElementChild
  }
  return out
}

function chainLast(el: Node): Element[] {
  const out: Element[] = []
  let c = (el as Element).lastElementChild
  while (c) {
    out.push(c)
    c = c.lastElementChild
  }
  return out
}

function ancestors(el: Element, root: Element): Element[] {
  const out: Element[] = []
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) out.unshift(p)
  return out
}

export function buildPrintRoot(editor: Editor, scopeClass: string): () => void {
  const root = editor.view.dom as HTMLElement
  const page = pageOf(editor.state.doc)
  const state = paginationKey.getState(editor.state)
  // Persist live checkbox state into attributes so clones keep it.
  root.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => i.toggleAttribute('checked', i.checked))

  const spacers = Array.from(root.querySelectorAll<HTMLElement>('[data-pg-spacer]'))
  const container = document.createElement('div')
  container.id = 'print-root'
  const style = document.createElement('style')
  style.textContent = `@page{size:${page.width}pt ${page.height}pt;margin:0}
.print-page{width:${page.width}pt;height:${page.height - 0.2}pt}
.print-page [data-resize-handle]{display:none!important}`

  for (let i = 0; i <= spacers.length; i++) {
    const range = document.createRange()
    if (i === 0) range.setStart(root, 0)
    else range.setStartAfter(spacers[i - 1])
    if (i === spacers.length) range.setEnd(root, root.childNodes.length)
    else range.setEndBefore(spacers[i])
    const frag = range.cloneContents()
    frag.querySelectorAll('[data-pg-spacer]').forEach((s) => s.remove())

    const host = document.createElement('div')
    host.appendChild(frag)

    // Continuation from the previous page: suppress space-before/indent and list markers.
    if (i > 0) {
      const anc = ancestors(spacers[i - 1], root)
      const chain = chainFirst(host)
      anc.forEach((a, k) => {
        const c = chain[k]
        if (!c) return
        if (a.tagName === 'LI') c.classList.add('pg-cont-li')
        if (TEXTBLOCK.test(a.tagName)) c.classList.add('pg-cont')
        if (a.tagName === 'TABLE' && !c.querySelector(':scope > colgroup')) {
          const cg = a.querySelector(':scope > colgroup')
          if (cg) c.insertBefore(cg.cloneNode(true), c.firstChild)
        }
      })
      if (state?.breaks[i - 1]?.kind === 'inline') {
        const tb = chain.find((c) => TEXTBLOCK.test(c.tagName))
        tb?.classList.add('pg-cont')
      }
    }
    // Cut at the end of this page: justified paragraphs keep their last line justified.
    if (i < spacers.length) {
      const anc = ancestors(spacers[i], root)
      const chain = chainLast(host)
      anc.forEach((a, k) => {
        const c = chain[k] as HTMLElement | undefined
        if (c && TEXTBLOCK.test(a.tagName) && getComputedStyle(a).textAlign === 'justify') c.style.textAlignLast = 'justify'
      })
    }
    host.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'))

    const pageEl = document.createElement('div')
    pageEl.className = `print-page ${scopeClass}`
    pageEl.style.background = page.background ?? '#fff'
    const doc = document.createElement('div')
    doc.className = 'sd-doc'
    doc.style.width = `${ptToPx(page.width)}px`
    doc.style.padding = `${ptToPx(page.margins.top)}px ${ptToPx(page.margins.right)}px 0 ${ptToPx(page.margins.left)}px`
    while (host.firstChild) doc.appendChild(host.firstChild)
    pageEl.appendChild(doc)
    for (const kind of ['header', 'footer'] as const) {
      const html = renderHF(editor.state.doc, kind, i, spacers.length + 1)
      if (!html) continue
      const el = document.createElement('div')
      el.className = 'sd-doc sd-hf'
      el.style.left = `${ptToPx(page.margins.left)}px`
      el.style.width = `${ptToPx(page.width - page.margins.left - page.margins.right)}px`
      if (kind === 'header') el.style.top = `${ptToPx(page.margins.header)}px`
      else el.style.bottom = `${ptToPx(page.margins.footer)}px`
      el.innerHTML = html
      pageEl.appendChild(el)
    }
    container.appendChild(pageEl)
  }

  document.head.appendChild(style)
  document.body.appendChild(container)
  return () => {
    container.remove()
    style.remove()
  }
}

/** Render the document to PDF bytes via Chromium's print pipeline. */
export async function renderPdf(editor: Editor, scopeClass: string, title: string): Promise<Uint8Array> {
  const cleanup = buildPrintRoot(editor, scopeClass)
  const prevTitle = document.title
  document.title = title
  try {
    await document.fonts.ready
    return await window.simpleDocs.exportPdf({ title })
  } finally {
    document.title = prevTitle
    cleanup()
  }
}

export async function printDocument(editor: Editor, scopeClass: string, title: string): Promise<boolean> {
  const cleanup = buildPrintRoot(editor, scopeClass)
  const prevTitle = document.title
  document.title = title
  try {
    await document.fonts.ready
    return await window.simpleDocs.print()
  } finally {
    document.title = prevTitle
    cleanup()
  }
}
