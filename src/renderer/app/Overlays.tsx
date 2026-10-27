import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react/menus'
import { ArrowDown, ArrowUp, Bold, CaseSensitive, ClipboardPaste, Copy, ExternalLink, Highlighter, Italic, Link2, Regex, Scissors, Strikethrough, TextSelect, Underline, WholeWord, X, Trash2, Merge, Split, Rows3, BookPlus, EyeOff } from 'lucide-react'
import { searchKey, setSearch, gotoMatch, replaceAll, replaceCurrent, type SearchQuery } from '@/editor/search'
import { misspelledAt } from '@/editor/spell'
import { addToDictionary, ignoreWord, suggestions } from '../spell/client'
import { useApp, set, toast } from '../state/store'
import { applyStyle, runCommand, shortcutFor } from './commands'
import { useSnapshot } from './hooks'
import { CtxContent, CtxItem, CtxMenu, CtxSep, CtxSub, CtxTrigger, IconBtn, cx, inputCls } from '../ui'

// ---------- find & replace ----------

export function FindBar({ editor }: { editor: Editor }) {
  const { open, replace } = useApp((s) => s.find)
  const st = useEditorState({ editor, selector: ({ editor: e }) => searchKey.getState(e.state) })
  const [text, setText] = useState('')
  const [rep, setRep] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const q = st?.query

  useEffect(() => {
    if (!open) {
      editor.view.dispatch(setSearch(editor.state.tr, { text: '' }))
      return
    }
    const sel = editor.state.selection
    const selected = !sel.empty && sel.to - sel.from < 200 ? editor.state.doc.textBetween(sel.from, sel.to, ' ') : ''
    if (selected && !selected.includes('\n')) {
      setText(selected)
      editor.view.dispatch(setSearch(editor.state.tr, { text: selected }))
    }
    requestAnimationFrame(() => input.current?.select())
  }, [open, editor])

  if (!open) return null
  const update = (patch: Partial<SearchQuery>) => editor.view.dispatch(setSearch(editor.state.tr, patch, 0))
  const go = (dir: 1 | -1) => {
    const tr = gotoMatch(editor.state, dir)
    if (tr) editor.view.dispatch(tr)
  }
  const close = () => {
    set({ find: { open: false, replace: false } })
    editor.commands.focus()
  }
  const toggle = (k: 'caseSensitive' | 'wholeWord' | 'regex', icon: ReactNode, label: string) => (
    <IconBtn label={label} size="sm" active={!!q?.[k]} onClick={() => update({ [k]: !q?.[k] })}>
      {icon}
    </IconBtn>
  )
  const count = st?.matches.length ?? 0
  return (
    <div className="pop-in absolute right-5 top-3 z-30 w-[380px] rounded-xl border border-border bg-elev p-2 shadow-[var(--shadow-pop)]" role="search" data-testid="find-bar">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            ref={input}
            aria-label="Find"
            placeholder="Find in document"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              update({ text: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') close()
            }}
            className={cx(inputCls, 'h-7 pr-16 text-[12.5px]')}
          />
          <span className={cx('absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums', st?.error ? 'text-danger' : 'text-text-3')}>
            {st?.error ? 'Invalid' : text ? `${count ? st!.current + 1 : 0}/${count}` : ''}
          </span>
        </div>
        {toggle('caseSensitive', <CaseSensitive className="size-3.5" />, 'Match case')}
        {toggle('wholeWord', <WholeWord className="size-3.5" />, 'Whole words')}
        {toggle('regex', <Regex className="size-3.5" />, 'Regular expression')}
        <IconBtn
          label="Search within selection"
          size="sm"
          active={!!q?.range}
          onClick={() => {
            const { from, to, empty } = editor.state.selection
            update({ range: q?.range || empty ? null : { from, to } })
          }}
        >
          <TextSelect className="size-3.5" />
        </IconBtn>
        <IconBtn label="Previous match" size="sm" shortcut="Shift-Enter" onClick={() => go(-1)}>
          <ArrowUp className="size-3.5" />
        </IconBtn>
        <IconBtn label="Next match" size="sm" shortcut="Enter" onClick={() => go(1)}>
          <ArrowDown className="size-3.5" />
        </IconBtn>
        <IconBtn label="Close" size="sm" onClick={close}>
          <X className="size-3.5" />
        </IconBtn>
      </div>
      {!replace ? (
        <button onClick={() => set({ find: { open: true, replace: true } })} className="mt-1 px-1 text-[11.5px] text-text-3 hover:text-accent-ink">
          Replace…
        </button>
      ) : (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            aria-label="Replace with"
            placeholder="Replace with"
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const tr = replaceCurrent(editor.state, rep)
                if (tr) editor.view.dispatch(tr)
                go(1)
              }
              if (e.key === 'Escape') close()
            }}
            className={cx(inputCls, 'h-7 flex-1 text-[12.5px]')}
          />
          <button
            className="h-7 rounded-md px-2 text-[12px] font-medium text-text-2 hover:bg-hover"
            onClick={() => {
              const tr = replaceCurrent(editor.state, rep)
              if (tr) editor.view.dispatch(tr)
              go(1)
            }}
          >
            Replace
          </button>
          <button
            className="h-7 rounded-md px-2 text-[12px] font-medium text-accent-ink hover:bg-accent-soft"
            onClick={() => {
              const r = replaceAll(editor.state, rep)
              if (r) {
                editor.view.dispatch(r.tr)
                toast(`Replaced ${r.count} ${r.count === 1 ? 'match' : 'matches'}`, 'success')
              }
            }}
          >
            All
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- floating selection toolbar ----------

export function FloatingToolbar({ editor }: { editor: Editor }) {
  const s = useSnapshot(editor)
  const btn = (id: string, icon: ReactNode, active: boolean, label: string) => (
    <IconBtn label={label} shortcut={shortcutFor(id)} active={active} size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand(id)}>
      {icon}
    </IconBtn>
  )
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ state, editor: e }) => !state.selection.empty && !e.isActive('image') && state.selection instanceof TextSelection && !useApp.getState().painter}
      className="pop-in z-40 flex items-center gap-0.5 rounded-xl border border-border bg-elev p-1 shadow-[var(--shadow-pop)]"
    >
      <select
        aria-label="Text style"
        value={s.styleId}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => applyStyle(editor, e.target.value)}
        className="h-6 rounded-md border-0 bg-transparent px-1 text-[12px] text-text-2 outline-none hover:bg-hover"
      >
        <option value="Normal">Text</option>
        <option value="Heading1">Heading 1</option>
        <option value="Heading2">Heading 2</option>
        <option value="Heading3">Heading 3</option>
        <option value="Title">Title</option>
        <option value="Quote">Quote</option>
      </select>
      <div className="mx-0.5 h-4 w-px bg-border" />
      {btn('fmt.bold', <Bold className="size-3.5" />, s.bold, 'Bold')}
      {btn('fmt.italic', <Italic className="size-3.5" />, s.italic, 'Italic')}
      {btn('fmt.underline', <Underline className="size-3.5" />, s.underline, 'Underline')}
      {btn('fmt.strike', <Strikethrough className="size-3.5" />, s.strike, 'Strikethrough')}
      <IconBtn label="Highlight" size="sm" active={!!s.highlight} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fff3a3' }).run()}>
        <Highlighter className="size-3.5" />
      </IconBtn>
      <div className="mx-0.5 h-4 w-px bg-border" />
      {btn('insert.link', <Link2 className="size-3.5" />, s.link, 'Link')}
    </BubbleMenu>
  )
}

// ---------- context menu ----------

export function EditorContextMenu({ editor, children }: { editor: Editor; children: ReactNode }) {
  const s = useSnapshot(editor)
  const href = editor.getAttributes('link').href as string | undefined
  const [spell, setSpell] = useState<{ word: string; from: number; to: number; list: string[] | null } | null>(null)
  const onContextMenu = (e: React.MouseEvent) => {
    const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
    const m = hit ? misspelledAt(editor.view, hit.pos) : null
    setSpell(m ? { ...m, list: null } : null)
    if (m) void suggestions(m.word).then((list) => setSpell((cur) => (cur && cur.word === m.word ? { ...cur, list } : cur)))
  }
  const replaceWith = (w: string) => spell && editor.chain().focus().insertContentAt({ from: spell.from, to: spell.to }, w).run()
  return (
    <CtxMenu>
      <CtxTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </CtxTrigger>
      <CtxContent>
        {spell && (
          <>
            {spell.list === null ? (
              <div className="px-2.5 py-1.5 text-[12px] text-text-3">Finding suggestions…</div>
            ) : spell.list.length ? (
              spell.list.map((w) => (
                <CtxItem key={w} onSelect={() => replaceWith(w)}>
                  <span className="font-semibold">{w}</span>
                </CtxItem>
              ))
            ) : (
              <div className="px-2.5 py-1.5 text-[12px] text-text-3">No suggestions</div>
            )}
            <CtxItem icon={<BookPlus />} onSelect={() => void addToDictionary(spell.word)}>
              Add “{spell.word}” to dictionary
            </CtxItem>
            <CtxItem icon={<EyeOff />} onSelect={() => ignoreWord(spell.word)}>
              Ignore all
            </CtxItem>
            <CtxSep />
          </>
        )}
        <CtxItem icon={<Scissors />} shortcut="Mod-x" onSelect={() => runCommand('edit.cut')}>
          Cut
        </CtxItem>
        <CtxItem icon={<Copy />} shortcut="Mod-c" onSelect={() => runCommand('edit.copy')}>
          Copy
        </CtxItem>
        <CtxItem icon={<ClipboardPaste />} shortcut="Mod-v" onSelect={() => runCommand('edit.paste')}>
          Paste
        </CtxItem>
        <CtxItem shortcut={shortcutFor('edit.pastePlain')} onSelect={() => runCommand('edit.pastePlain')}>
          Paste as plain text
        </CtxItem>
        <CtxSep />
        {href && (
          <>
            <CtxItem icon={<ExternalLink />} onSelect={() => void window.simpleDocs.openExternal(href).catch(() => toast('That link cannot be opened', 'error'))}>
              Open link
            </CtxItem>
            <CtxItem onSelect={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>Remove link</CtxItem>
          </>
        )}
        <CtxItem icon={<Link2 />} shortcut={shortcutFor('insert.link')} onSelect={() => runCommand('insert.link')}>
          {href ? 'Edit link…' : 'Link…'}
        </CtxItem>
        {s.inTable && (
          <>
            <CtxSep />
            <CtxSub label="Table" icon={<Rows3 />}>
              <CtxItem onSelect={() => runCommand('table.addRowBefore')}>Insert row above</CtxItem>
              <CtxItem onSelect={() => runCommand('table.addRowAfter')}>Insert row below</CtxItem>
              <CtxItem onSelect={() => runCommand('table.addColBefore')}>Insert column left</CtxItem>
              <CtxItem onSelect={() => runCommand('table.addColAfter')}>Insert column right</CtxItem>
              <CtxSep />
              <CtxItem icon={<Merge />} onSelect={() => runCommand('table.merge')}>
                Merge cells
              </CtxItem>
              <CtxItem icon={<Split />} onSelect={() => runCommand('table.split')}>
                Split cell
              </CtxItem>
              <CtxSep />
              <CtxItem onSelect={() => runCommand('table.deleteRow')}>Delete row</CtxItem>
              <CtxItem onSelect={() => runCommand('table.deleteCol')}>Delete column</CtxItem>
              <CtxItem icon={<Trash2 />} onSelect={() => runCommand('table.delete')}>
                Delete table
              </CtxItem>
            </CtxSub>
          </>
        )}
        <CtxSep />
        <CtxItem onSelect={() => set({ rightPanel: 'format' })}>Paragraph…</CtxItem>
        <CtxItem shortcut={shortcutFor('edit.selectAll')} onSelect={() => runCommand('edit.selectAll')}>
          Select all
        </CtxItem>
      </CtxContent>
    </CtxMenu>
  )
}
