import { Editor, type JSONContent } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { createExtensions } from './extensions'
import { Pagination, type PaginationOptions } from '@/layout/plugin'
import { Search } from './search'
import { defaultStyles, makePageSetup, MARGIN_PRESETS, PAGE_SIZES, type DocMeta, type PageSetup, type StyleMap } from './model'

export interface NewDocOptions {
  font?: string
  fontSize?: number
  pageSize?: keyof typeof PAGE_SIZES
  margins?: keyof typeof MARGIN_PRESETS
}

export function emptyDoc(o: NewDocOptions = {}, content?: JSONContent[]): JSONContent {
  return {
    type: 'doc',
    attrs: {
      page: makePageSetup(o.pageSize, o.margins),
      styles: defaultStyles(o.font, o.fontSize),
      meta: { created: new Date().toISOString() } satisfies DocMeta
    },
    content: content?.length ? content : [{ type: 'paragraph' }]
  }
}

/** Fill in doc attrs that an importer did not provide. Imported styles override defaults by id. */
export function normalizeDoc(doc: JSONContent, o: NewDocOptions = {}): JSONContent {
  const attrs = doc.attrs ?? {}
  return {
    ...doc,
    type: 'doc',
    attrs: {
      page: (attrs.page as PageSetup | undefined) ?? makePageSetup(o.pageSize, o.margins),
      styles: { ...defaultStyles(o.font, o.fontSize), ...((attrs.styles as StyleMap | undefined) ?? {}) },
      meta: attrs.meta ?? {}
    },
    content: doc.content?.length ? doc.content : [{ type: 'paragraph' }]
  }
}

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function insertImages(view: EditorView, files: File[], pos?: number) {
  for (const f of files) {
    const src = await readAsDataUrl(f)
    const node = view.state.schema.nodes.image.create({ src, alt: f.name.replace(/\.[^.]+$/, '') })
    const tr = pos == null ? view.state.tr.replaceSelectionWith(node) : view.state.tr.insert(pos, node)
    view.dispatch(tr.scrollIntoView())
  }
}

export interface CreateEditorOptions extends PaginationOptions {
  content: JSONContent
  placeholder?: string
  onDocFiles?: (files: File[]) => void
}

export function createDocEditor(opts: CreateEditorOptions): Editor {
  return new Editor({
    extensions: [...createExtensions({ placeholder: opts.placeholder }), Pagination.configure({ onLayout: opts.onLayout }), Search],
    content: opts.content,
    enableContentCheck: true,
    editorProps: {
      attributes: { class: 'sd-doc', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document body' },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => IMAGE_TYPES.test(f.type))
        if (!files.length) return false
        void insertImages(view, files)
        return true
      },
      handleDrop(view, event) {
        const all = Array.from(event.dataTransfer?.files ?? [])
        if (!all.length) return false
        const images = all.filter((f) => IMAGE_TYPES.test(f.type))
        const docs = all.filter((f) => !IMAGE_TYPES.test(f.type))
        if (docs.length) opts.onDocFiles?.(docs)
        if (images.length) {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
          void insertImages(view, images, at?.pos)
        }
        return true
      }
    }
  })
}
