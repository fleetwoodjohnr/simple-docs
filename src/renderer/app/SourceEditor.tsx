import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import MarkdownIt from 'markdown-it'
import { docToMarkdown, markdownToDoc } from '@/formats/markdown'
import { sanitize } from '@/formats/html'
import { AlertTriangle } from 'lucide-react'
import { Tip } from '../ui'

const md = new MarkdownIt({ html: false, linkify: true })

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.3em', color: 'var(--text)' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.15em', color: 'var(--text)' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '700', color: 'var(--text)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--accent)', opacity: '0.8' },
  { tag: tags.monospace, fontFamily: '"Liberation Mono", monospace', color: '#c2410c' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--text-3)' },
  { tag: tags.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--accent)' }
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--panel)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: '"Liberation Mono", ui-monospace, monospace', lineHeight: '1.65', padding: '16px 0' },
  '.cm-content': { caretColor: 'var(--accent)', maxWidth: '760px', margin: '0 auto', padding: '0 28px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-3)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' }
})

export function SourceEditor({ editor }: { editor: Editor }) {
  const host = useRef<HTMLDivElement>(null)
  const initial = useMemo(() => docToMarkdown(editor.getJSON()), [editor])
  const [text, setText] = useState(initial.markdown)
  const timer = useRef<number>(0)

  useEffect(() => {
    const view = new EditorView({
      doc: initial.markdown,
      parent: host.current!,
      extensions: [
        basicSetup,
        markdown(),
        syntaxHighlighting(highlight),
        theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const value = u.state.doc.toString()
          setText(value)
          window.clearTimeout(timer.current)
          // Push source edits into the rich document (one undo step per pause).
          timer.current = window.setTimeout(() => {
            const parsed = markdownToDoc(value)
            editor.commands.setContent({ ...parsed, attrs: editor.state.doc.attrs }, { emitUpdate: true })
          }, 400)
        })
      ]
    })
    view.focus()
    return () => {
      window.clearTimeout(timer.current)
      view.destroy()
    }
  }, [editor, initial])

  const html = useMemo(() => sanitize(md.render(text)), [text])
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 border-r border-border">
        {initial.warnings.length > 0 && (
          <Tip label={initial.warnings.map((w) => w.message).join(' · ')}>
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-warn/10 px-2.5 py-1 text-[11.5px] font-medium text-warn">
              <AlertTriangle className="size-3.5" />
              {initial.warnings.length} rich features not shown in Markdown
            </div>
          </Tip>
        )}
        <div ref={host} className="h-full" data-testid="markdown-source" />
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-workspace p-8">
        <article className="md-preview mx-auto max-w-[680px] rounded-lg bg-white px-12 py-10 text-[15px] leading-relaxed text-zinc-900 shadow-[var(--shadow-page)]" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
