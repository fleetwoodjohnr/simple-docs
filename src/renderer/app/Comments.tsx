import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Check, MessageSquarePlus, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { commentRange, commentsOf, commentUiKey, deleteComment, focusComment, orderedCommentIds, replyComment, updateComment, type CommentThread } from '@/editor/comments'
import { useApp } from '../state/store'
import { Btn, IconBtn, cx } from '../ui'
import { Empty } from './Panels'

const when = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'

function Avatar({ name }: { name: string }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: `hsl(${h} 55% 52%)` }}>
      {initials(name)}
    </span>
  )
}

function Thread({ editor, id, thread, active, author }: { editor: Editor; id: string; thread: CommentThread; active: boolean; author: string }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(!thread.text)
  const [body, setBody] = useState(thread.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing && active) ref.current?.focus()
  }, [editing, active])
  const range = commentRange(editor.state.doc, id)
  const quote = range ? editor.state.doc.textBetween(range.from, range.to, ' ').slice(0, 140) : ''
  const save = () => {
    updateComment(editor, id, { text: body.trim() })
    setEditing(false)
  }
  return (
    <article
      onClick={() => !active && focusComment(editor, id)}
      className={cx('rounded-xl border bg-panel p-3 transition-shadow', active ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-border hover:border-border-strong', thread.resolved && 'opacity-60')}
      data-testid="comment-thread"
    >
      {quote && <div className="mb-2 line-clamp-2 border-l-2 border-[#f5b400] pl-2 text-[11.5px] italic text-text-3">{quote}</div>}
      <header className="flex items-center gap-2">
        <Avatar name={thread.author} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold">{thread.author}</div>
          <div className="text-[11px] text-text-3">{when(thread.date)}</div>
        </div>
        <IconBtn label={thread.resolved ? 'Reopen' : 'Resolve'} size="sm" onClick={(e) => (e.stopPropagation(), updateComment(editor, id, { resolved: !thread.resolved }))}>
          {thread.resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
        </IconBtn>
        <IconBtn label="Delete comment" size="sm" onClick={(e) => (e.stopPropagation(), deleteComment(editor, id))}>
          <Trash2 className="size-3.5" />
        </IconBtn>
      </header>
      {editing ? (
        <div className="mt-2">
          <textarea
            ref={ref}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
              if (e.key === 'Escape') setEditing(false)
            }}
            placeholder="Add a comment…"
            aria-label="Comment text"
            className="min-h-[64px] w-full resize-y rounded-lg border border-border bg-panel-2 p-2 text-[12.5px] outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Btn size="sm" variant="ghost" onClick={() => (thread.text ? setEditing(false) : deleteComment(editor, id))}>
              Cancel
            </Btn>
            <Btn size="sm" variant="primary" onClick={save} disabled={!body.trim()}>
              Comment
            </Btn>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed" onDoubleClick={() => setEditing(true)}>
          {thread.text}
        </p>
      )}
      {thread.replies.map((r, i) => (
        <div key={i} className="mt-2.5 border-t border-border pt-2.5">
          <div className="flex items-center gap-2">
            <Avatar name={r.author} />
            <span className="text-[12px] font-semibold">{r.author}</span>
            <span className="text-[11px] text-text-3">{when(r.date)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap pl-8 text-[12.5px] leading-relaxed">{r.text}</p>
        </div>
      ))}
      {active && !editing && !thread.resolved && (
        <div className="mt-2.5 flex gap-1.5 border-t border-border pt-2.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                replyComment(editor, id, author, draft)
                setDraft('')
              }
            }}
            placeholder="Reply…"
            aria-label="Reply"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-panel-2 px-2 text-[12px] outline-none focus:border-accent"
          />
        </div>
      )}
    </article>
  )
}

export function CommentsPanel({ editor }: { editor: Editor }) {
  const author = useApp((s) => s.settings.authorName) || 'Author'
  const [showResolved, setShowResolved] = useState(true)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ comments: commentsOf(e.state.doc), order: orderedCommentIds(e.state.doc), active: commentUiKey.getState(e.state)?.active ?? null })
  })
  if (!state) return null
  const ids = state.order.filter((id) => state.comments[id] && (showResolved || !state.comments[id].resolved))
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <Btn size="sm" variant="soft" onClick={() => document.dispatchEvent(new CustomEvent('sd:new-comment'))} disabled={editor.state.selection.empty}>
          <MessageSquarePlus className="size-3.5" /> New comment
        </Btn>
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-3">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-[var(--accent)]" /> Resolved
        </label>
      </div>
      {!ids.length ? (
        <Empty icon={<MessageSquare className="size-5" />} title="No comments">
          Select text and choose New comment (Ctrl+Alt+M).
        </Empty>
      ) : (
        ids.map((id) => <Thread key={id} editor={editor} id={id} thread={state.comments[id]} active={state.active === id} author={author} />)
      )}
    </div>
  )
}
