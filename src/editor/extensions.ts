import { Extension, Mark, Node, mergeAttributes, type Extensions } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import { BulletList, OrderedList, ListItem, TaskList, TaskItem } from '@tiptap/extension-list'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { NumberingPlugin } from './numbering'
import { Toc, TocEntry, TocNavigation } from './toc'
import { Footnote, NoteClicks } from './notes'
import { Comment } from './comments'
import { Deletion, Insertion, TrackChanges } from './track'
import { TableStyles } from './tables'

// ---------- helpers ----------

/** Parse a CSS length into points. Returns null when absent/unparseable. */
export function cssToPt(v: string | null | undefined): number | null {
  if (!v) return null
  const m = /^(-?[\d.]+)(pt|px|in|cm|mm|em)?$/.exec(v.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  switch (m[2]) {
    case 'px':
      return round(n * 0.75)
    case 'in':
      return round(n * 72)
    case 'cm':
      return round((n * 72) / 2.54)
    case 'mm':
      return round((n * 72) / 25.4)
    case 'em':
      return round(n * 12)
    default:
      return round(n)
  }
}
const round = (n: number) => Math.round(n * 100) / 100
const flag = (name: string, key: string) => ({
  default: false,
  parseHTML: (el: HTMLElement) => el.hasAttribute(name),
  renderHTML: (a: Record<string, unknown>) => (a[key] ? { [name]: '' } : {})
})

const styleAttr = (prop: string, unit: string, key: string) => ({
  default: null as number | null,
  parseHTML: (el: HTMLElement) => cssToPt(el.style.getPropertyValue(prop)),
  renderHTML: (a: Record<string, unknown>) => (a[key] == null ? {} : { style: `${prop}:${a[key]}${unit}` })
})

// ---------- document ----------

export const SdDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
  addAttributes() {
    return { page: { default: null }, styles: { default: null }, meta: { default: null }, hf: { default: null }, comments: { default: null }, trackChanges: { default: false } }
  }
})

// ---------- paragraph formatting (paragraph + heading) ----------

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          styleId: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute('data-style')
              return v && !/^Heading[1-9]$/.test(v) ? v : null
            },
            renderHTML: (a) => {
              const id = a.styleId ?? (a.level ? `Heading${a.level}` : null)
              return id ? { 'data-style': id } : {}
            }
          },
          align: {
            default: null,
            parseHTML: (el) => {
              const v = el.style.textAlign || el.getAttribute('align')
              return v && /^(left|center|right|justify)$/.test(v) ? v : null
            },
            renderHTML: (a) => (a.align ? { style: `text-align:${a.align}` } : {})
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => {
              const v = el.style.getPropertyValue('--lh') || el.getAttribute('data-line-height')
              return v ? parseFloat(v) || null : null
            },
            renderHTML: (a) => (a.lineHeight ? { style: `--lh:${a.lineHeight}` } : {})
          },
          spaceBefore: styleAttr('padding-top', 'pt', 'spaceBefore'),
          spaceAfter: styleAttr('margin-bottom', 'pt', 'spaceAfter'),
          indentLeft: styleAttr('margin-left', 'pt', 'indentLeft'),
          indentRight: styleAttr('margin-right', 'pt', 'indentRight'),
          indentFirst: styleAttr('text-indent', 'pt', 'indentFirst'),
          keepNext: flag('data-keep-next', 'keepNext'),
          keepLines: flag('data-keep-lines', 'keepLines'),
          pageBreakBefore: {
            default: false,
            parseHTML: (el) => el.hasAttribute('data-page-break-before') || el.style.breakBefore === 'page' || el.style.pageBreakBefore === 'always',
            renderHTML: (a) => (a.pageBreakBefore ? { 'data-page-break-before': '' } : {})
          },
          dir: {
            default: null,
            parseHTML: (el) => (el.getAttribute('dir') === 'rtl' ? 'rtl' : null),
            renderHTML: (a) => (a.dir ? { dir: a.dir } : {})
          },
          shading: {
            default: null,
            parseHTML: (el) => el.style.backgroundColor || null,
            renderHTML: (a) => (a.shading ? { style: `background-color:${a.shading}` } : {})
          }
        }
      },
      {
        types: ['textStyle'],
        attributes: {
          letterSpacing: {
            default: null,
            parseHTML: (el) => cssToPt(el.style.letterSpacing),
            renderHTML: (a) => (a.letterSpacing == null ? {} : { style: `letter-spacing:${a.letterSpacing}pt` })
          },
          caps: {
            default: null,
            parseHTML: (el) => (el.style.textTransform === 'uppercase' ? true : null),
            renderHTML: (a) => (a.caps ? { style: 'text-transform:uppercase' } : {})
          },
          smallCaps: {
            default: null,
            parseHTML: (el) => (el.style.fontVariant === 'small-caps' || el.style.fontVariantCaps === 'small-caps' ? true : null),
            renderHTML: (a) => (a.smallCaps ? { style: 'font-variant-caps:small-caps' } : {})
          }
        }
      }
    ]
  }
})

export const SdHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level as number
    if (level <= 6) return [`h${level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { role: 'heading', 'aria-level': String(level) }), 0]
  },
  parseHTML() {
    return [
      ...[1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      { tag: 'p[role=heading]', getAttrs: (el: HTMLElement) => ({ level: Math.min(9, Math.max(1, Number(el.getAttribute('aria-level')) || 7)) }) }
    ]
  }
}).configure({ levels: [1, 2, 3, 4, 5, 6, 7, 8, 9] as never })

// ---------- marks ----------

export const DoubleStrike = Mark.create({
  name: 'doubleStrike',
  parseHTML() {
    return [{ tag: 'span[data-dstrike]' }, { style: 'text-decoration-style=double', getAttrs: () => ({}) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-dstrike': '', style: 'text-decoration:line-through double' }), 0]
  }
})

// ---------- blocks ----------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType }
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }, { tag: 'hr[data-page-break]' }]
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'sd-page-break', contenteditable: 'false' }]
  },
  addCommands() {
    return {
      // Like Word: text after the cursor moves to the new page; the cursor lands after the break.
      setPageBreak:
        () =>
        ({ state, tr, dispatch }) => {
          // A non-empty selection breaks after its end.
          const { $from } = state.selection.empty ? state.selection : TextSelection.near(state.selection.$to, -1)
          const block = $from.parent
          if (!block.isTextblock) return false
          const pb = state.schema.nodes.pageBreak.create()
          if (dispatch && $from.depth > 1) {
            // Inside a list or table: break after the whole top-level block.
            const at = $from.after(1)
            tr.insert(at, [pb, state.schema.nodes.paragraph.create()])
            tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView()
          } else if (dispatch) {
            if (block.content.size === 0 || $from.parentOffset === 0) tr.insert($from.before(), pb)
            else {
              const atEnd = $from.parentOffset === block.content.size
              tr.split($from.pos, 1, atEnd ? [{ type: state.schema.nodes.paragraph }] : undefined)
              tr.insert(tr.mapping.map($from.pos, -1) + 1, pb)
            }
            tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($from.pos)))
            tr.scrollIntoView()
          }
          return true
        }
    }
  }
})

/** Content from an imported file that the editor cannot edit but must keep (raw XML etc.). */
const preserved = (inline: boolean) =>
  Node.create({
    name: inline ? 'preservedInline' : 'preservedBlock',
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        format: { default: 'docx' },
        label: { default: 'Unsupported content' },
        raw: { default: '' },
        text: { default: '' }
      }
    },
    parseHTML() {
      return [
        {
          tag: `${inline ? 'span' : 'div'}[data-preserved]`,
          getAttrs: (el: HTMLElement) => ({
            format: el.getAttribute('data-format') ?? 'docx',
            label: el.getAttribute('data-label') ?? 'Unsupported content',
            raw: el.getAttribute('data-raw') ?? '',
            text: el.textContent ?? ''
          })
        }
      ]
    },
    renderHTML({ node }) {
      return [
        inline ? 'span' : 'div',
        {
          'data-preserved': '',
          'data-format': node.attrs.format,
          'data-label': node.attrs.label,
          'data-raw': node.attrs.raw,
          class: inline ? 'sd-preserved sd-preserved-inline' : 'sd-preserved',
          title: `${node.attrs.label} — preserved from the original file and written back on save`
        },
        node.attrs.text || node.attrs.label
      ]
    }
  })
export type FieldKind = 'page' | 'pages' | 'date' | 'title' | 'author'

export const FIELD_LABELS: Record<FieldKind, string> = { page: '#', pages: '##', date: 'Date', title: 'Title', author: 'Author' }

/** Dynamic text resolved when rendered (page numbers in headers/footers, date, title…). */
export const Field = Node.create({
  name: 'field',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'page' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-field]', getAttrs: (el: HTMLElement) => ({ kind: el.getAttribute('data-field') }) }]
  },
  renderHTML({ node }) {
    return ['span', { 'data-field': node.attrs.kind, class: 'sd-field', contenteditable: 'false' }, FIELD_LABELS[node.attrs.kind as FieldKind] ?? '?']
  }
})

export const PreservedBlock = preserved(false)
export const PreservedInline = preserved(true)

// ---------- lists ----------

export const SdBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bullet: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-bullet'),
        renderHTML: (a) => (a.bullet ? { 'data-bullet': a.bullet, style: `--bullet:"${String(a.bullet).replace(/["\\]/g, '\\$&')}"` } : {})
      }
    }
  }
})

export const SdOrderedList = OrderedList

export const SdListItem = ListItem

// ---------- images ----------

export const SdImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      float: {
        default: null,
        parseHTML: (el) => {
          const f = el.getAttribute('data-float') || el.style.float
          return f === 'left' || f === 'right' ? f : null
        },
        renderHTML: (a) => (a.float ? { 'data-float': a.float } : {})
      }
    }
  }
}).configure({
  inline: true,
  allowBase64: true,
  resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 16, minHeight: 16, directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'] }
})

// ---------- tables ----------

const cellAttrs = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute('data-bg') || null,
    renderHTML: (a: Record<string, unknown>) => (a.background ? { style: `background-color:${a.background}` } : {})
  },
  verticalAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.verticalAlign
      return v === 'middle' || v === 'bottom' ? v : null
    },
    renderHTML: (a: Record<string, unknown>) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign}` } : {})
  }
}

export const SdTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs }
  }
})
export const SdTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs }
  }
})

// ---------- keyboard: Tab inserts a tab character outside lists/tables ----------

export const TabKey = Extension.create({
  name: 'tabKey',
  priority: 10,
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.insertContent('\t'),
      'Shift-Tab': () => true
    }
  }
})

export const Numbering = Extension.create({
  name: 'numbering',
  addProseMirrorPlugins() {
    return [NumberingPlugin()]
  }
})

export interface ExtensionOptions {
  placeholder?: string
}

/** All schema + behaviour extensions. Safe to call in Node (no DOM needed to build the schema). */
export function createExtensions(opts: ExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      document: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      undoRedo: { depth: 1000, newGroupDelay: 600 },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: null }
      },
      dropcursor: { color: 'var(--accent)', width: 2 }
    }),
    SdDocument,
    SdHeading,
    SdBulletList,
    SdOrderedList,
    SdListItem,
    TaskList,
    TaskItem.configure({ nested: true }),
    ParagraphFormat,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    DoubleStrike,
    SdImage,
    Table.configure({ resizable: true, cellMinWidth: 32, lastColumnResizable: true, allowTableNodeSelection: true }),
    TableRow,
    SdTableCell,
    SdTableHeader,
    TableStyles,
    PageBreak,
    PreservedBlock,
    PreservedInline,
    Field,
    Toc,
    TocEntry,
    TocNavigation,
    Footnote,
    NoteClicks,
    Comment,
    Insertion,
    Deletion,
    TrackChanges,
    TabKey,
    Numbering,
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder, showOnlyWhenEditable: true })] : [])
  ]
}
