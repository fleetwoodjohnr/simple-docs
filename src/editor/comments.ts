import { Mark, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Comments: a mark anchors the commented range (overlaps allowed); thread content
// lives in the doc attribute `comments` so it travels with undo, save and recovery.

export interface CommentReply {
  author: string
  date: string
  text: string
}

export interface CommentThread extends CommentReply {
  resolved: boolean
  replies: CommentReply[]
}

export type CommentMap = Record<string, CommentThread>

export const commentsOf = (doc: PMNode): CommentMap => (doc.attrs.comments as CommentMap | null) ?? {}

export const commentUiKey = new PluginKey<{ active: string | null; deco: DecorationSet }>('commentUi')

export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute('data-comment') } }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },
  renderHTML({ mark }) {
    return ['span', { 'data-comment': mark.attrs.id, class: 'sd-comment' }, 0]
  },
  addProseMirrorPlugins() {
    const build = (doc: PMNode, active: string | null) => {
      const comments = commentsOf(doc)
      const decos: Decoration[] = []
      doc.descendants((n, pos) => {
        if (!n.isText) return
        for (const m of n.marks) {
          if (m.type.name !== 'comment') continue
          const id = m.attrs.id as string
          const cls = id === active ? 'sd-comment-active' : comments[id]?.resolved ? 'sd-comment-resolved' : ''
          if (cls) decos.push(Decoration.inline(pos, pos + n.nodeSize, { class: cls }))
        }
      })
      return DecorationSet.create(doc, decos)
    }
    return [
      new Plugin<{ active: string | null; deco: DecorationSet }>({
        key: commentUiKey,
        state: {
          init: (_c, s) => ({ active: null, deco: build(s.doc, null) }),
          apply(tr, prev) {
            const meta = tr.getMeta(commentUiKey) as { active: string | null } | undefined
            const active = meta ? meta.active : prev.active
            if (!meta && !tr.docChanged) return prev
            return { active, deco: build(tr.doc, active) }
          }
        },
        props: {
          decorations: (s) => commentUiKey.getState(s)?.deco,
          handleClick(view, pos) {
            const marks = view.state.doc.resolve(pos).marks().filter((m) => m.type.name === 'comment')
            const id = (marks[marks.length - 1]?.attrs.id as string) ?? null
            if (id !== commentUiKey.getState(view.state)?.active) view.dispatch(view.state.tr.setMeta(commentUiKey, { active: id }))
            if (id) window.dispatchEvent(new CustomEvent('sd:open-comment', { detail: id }))
            return false
          }
        }
      })
    ]
  }
})

export function newCommentId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function setComments(editor: Editor, next: CommentMap, extra?: (tr: import('@tiptap/pm/state').Transaction) => void) {
  const tr = editor.state.tr.setDocAttribute('comments', next)
  extra?.(tr)
  editor.view.dispatch(tr)
}

export function addComment(editor: Editor, author: string): string | null {
  const { from, to, empty } = editor.state.selection
  if (empty) return null
  const id = newCommentId()
  const thread: CommentThread = { author, date: new Date().toISOString(), text: '', resolved: false, replies: [] }
  setComments(editor, { ...commentsOf(editor.state.doc), [id]: thread }, (tr) => {
    tr.addMark(from, to, editor.schema.marks.comment.create({ id }))
    tr.setMeta(commentUiKey, { active: id })
  })
  return id
}

export function updateComment(editor: Editor, id: string, patch: Partial<CommentThread>) {
  const all = commentsOf(editor.state.doc)
  if (!all[id]) return
  setComments(editor, { ...all, [id]: { ...all[id], ...patch } })
}

export function replyComment(editor: Editor, id: string, author: string, text: string) {
  const all = commentsOf(editor.state.doc)
  if (!all[id] || !text.trim()) return
  updateComment(editor, id, { replies: [...all[id].replies, { author, date: new Date().toISOString(), text }] })
}

export function deleteComment(editor: Editor, id: string) {
  const { [id]: _gone, ...rest } = commentsOf(editor.state.doc)
  setComments(editor, rest, (tr) => {
    tr.doc.descendants((n, pos) => {
      const m = n.marks.find((x) => x.type.name === 'comment' && x.attrs.id === id)
      if (m) tr.removeMark(pos, pos + n.nodeSize, m)
    })
    tr.setMeta(commentUiKey, { active: null })
  })
}

/** Range covered by a comment (first to last marked character), or null if its text was deleted. */
export function commentRange(doc: PMNode, id: string): { from: number; to: number } | null {
  let from = -1
  let to = -1
  doc.descendants((n, pos) => {
    if (n.isText && n.marks.some((m) => m.type.name === 'comment' && m.attrs.id === id)) {
      if (from < 0) from = pos
      to = pos + n.nodeSize
    }
  })
  return from < 0 ? null : { from, to }
}

/** Comment ids in document order (only those still anchored). */
export function orderedCommentIds(doc: PMNode): string[] {
  const seen: string[] = []
  doc.descendants((n) => {
    if (n.isText) for (const m of n.marks) if (m.type.name === 'comment' && !seen.includes(m.attrs.id)) seen.push(m.attrs.id)
  })
  return seen
}

export function focusComment(editor: Editor, id: string) {
  const r = commentRange(editor.state.doc, id)
  const tr = editor.state.tr.setMeta(commentUiKey, { active: id })
  if (r) tr.setSelection(TextSelection.create(tr.doc, r.from)).scrollIntoView()
  editor.view.dispatch(tr)
}
