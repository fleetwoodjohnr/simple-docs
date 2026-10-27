import { useMemo, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { FileText, Hash, Minus, Plus, X, Clock, BookOpenText } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp, set, type LeftPanel, type RightPanel } from '../state/store'
import * as docs from '../state/documents'
import { useActiveEditor, useBodyEditor, usePageInfo, useSnapshot, useStats, useThrottled } from './hooks'
import { applyStyle, runCommand, updateBlocks, zoomTo } from './commands'
import { IconBtn, NumberInput, Segmented, cx, inputCls } from '../ui'
import { pageOf, paginationKey, PAGE_GAP } from '@/layout/plugin'
import { CommentsPanel } from './Comments'
import { AccessibilityPanel } from './Accessibility'
import { MARGIN_PRESETS, PAGE_SIZES, ptToPx, withOrientation, withSize, type PageSetup, type StyleMap } from '@/editor/model'

// ---------- helpers ----------

interface HeadingEntry {
  level: number
  text: string
  pos: number
}

const headingCache = new WeakMap<object, HeadingEntry[]>()
function headings(e: Editor): HeadingEntry[] {
  const doc = e.state.doc
  const c = headingCache.get(doc)
  if (c) return c
  const out: HeadingEntry[] = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'heading') out.push({ level: n.attrs.level, text: n.textContent, pos })
    else if (n.type.name === 'paragraph' && n.attrs.styleId === 'Title') out.push({ level: 0, text: n.textContent, pos })
    return !n.isTextblock
  })
  headingCache.set(doc, out)
  return out
}

export function goTo(e: Editor, pos: number) {
  const $p = e.state.doc.resolve(Math.min(pos + 1, e.state.doc.content.size))
  e.view.dispatch(e.state.tr.setSelection(TextSelection.near($p)))
  e.view.focus()
  const dom = e.view.domAtPos($p.pos).node as HTMLElement
  ;(dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: 'center', behavior: useApp.getState().settings.reduceMotion ? 'auto' : 'smooth' })
}

export function scrollToPage(tabId: string, e: Editor, page: number) {
  const sc = document.querySelector<HTMLElement>(`[data-doc-scroll="${tabId}"]`)
  if (!sc) return
  const p = pageOf(e.state.doc)
  sc.scrollTo({ top: (page - 1) * (ptToPx(p.height) + PAGE_GAP) * useApp.getState().zoom, behavior: 'smooth' })
}

function PanelHeader({ tabs, value, onChange, onClose }: { tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void; onClose: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <Segmented value={value} label="Panel" onChange={onChange} options={tabs.map((t) => ({ value: t.id, label: t.label }))} />
      <div className="flex-1" />
      <IconBtn label="Close panel" size="sm" onClick={onClose}>
        <X className="size-3.5" />
      </IconBtn>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-3.5">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] text-text-2">{label}</span>
      {children}
    </div>
  )
}

// ---------- left ----------

function Outline({ editor }: { editor: Editor }) {
  const list = useThrottled(editor, headings, [] as HeadingEntry[], 250)
  const head = useEditorState({ editor, selector: ({ editor: e }) => e.state.selection.head }) ?? 0
  const current = [...list].reverse().find((h) => h.pos <= head)
  if (!list.length)
    return (
      <Empty icon={<Hash className="size-5" />} title="No headings yet">
        Use heading styles (Ctrl+Alt+1…3) to build an outline you can navigate.
      </Empty>
    )
  const minLevel = Math.min(...list.map((h) => h.level || 1))
  return (
    <nav aria-label="Document outline" className="p-2">
      {list.map((h) => (
        <button
          key={h.pos}
          onClick={() => goTo(editor, h.pos)}
          className={cx(
            'block w-full truncate rounded-md py-1.5 pr-2 text-left text-[12.5px] transition-colors hover:bg-hover',
            current === h ? 'bg-accent-soft font-medium text-accent-ink' : h.level <= 1 ? 'font-medium text-text' : 'text-text-2'
          )}
          style={{ paddingLeft: 8 + Math.max(0, (h.level || 1) - minLevel) * 14 }}
        >
          {h.text || <span className="italic text-text-3">Empty heading</span>}
        </button>
      ))}
    </nav>
  )
}

function Pages({ editor, tabId }: { editor: Editor; tabId: string }) {
  const info = usePageInfo(editor)
  const snippets = useThrottled(
    editor,
    (e) => {
      const st = paginationKey.getState(e.state)
      const starts = [0, ...(st?.breaks.map((b) => b.pos) ?? [])]
      return starts.map((from, i) => {
        const to = starts[i + 1] ?? e.state.doc.content.size
        return e.state.doc.textBetween(from, Math.min(to, from + 400), ' ', ' ').trim().slice(0, 90)
      })
    },
    [] as string[],
    500
  )
  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {(snippets ?? []).map((s, i) => (
        <button key={i} onClick={() => scrollToPage(tabId, editor, i + 1)} className="group text-left">
          <div className={cx('aspect-[1/1.294] overflow-hidden rounded-md border bg-white p-2 shadow-sm transition-all group-hover:border-accent', info.current === i + 1 ? 'border-accent ring-2 ring-accent-soft' : 'border-border')}>
            <div className="space-y-1">
              <div className="h-1 w-3/4 rounded bg-zinc-300" />
              <p className="line-clamp-6 text-[7px] leading-[1.35] text-zinc-500">{s || ' '}</p>
            </div>
          </div>
          <div className="mt-1 text-center text-[11px] text-text-3">{i + 1}</div>
        </button>
      ))}
    </div>
  )
}

function Recent() {
  const recents = useApp((s) => s.recents)
  if (!recents.length)
    return (
      <Empty icon={<Clock className="size-5" />} title="No recent files">
        Files you open or save appear here.
      </Empty>
    )
  return (
    <div className="p-2">
      {recents.slice(0, 30).map((r) => (
        <button key={r.path} onClick={() => docs.openPath(r.path)} title={r.path} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover">
          <FileText className="size-4 shrink-0 text-text-3" />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-text">{r.name}</span>
            <span className="block truncate text-[11px] text-text-3">{r.path.replace(/[\\/][^\\/]+$/, '')}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-hover text-text-3">{icon}</div>
      <div className="text-[13px] font-medium text-text">{title}</div>
      {children && <p className="mt-1 text-[12px] leading-relaxed text-text-3">{children}</p>}
    </div>
  )
}

export function LeftSidebar() {
  const panel = useApp((s) => s.leftPanel)
  const active = useApp((s) => s.active)
  const editor = useBodyEditor()
  if (!panel || !editor) return null
  return (
    <aside aria-label="Navigation" className="slide-up flex w-[248px] shrink-0 flex-col border-r border-border bg-panel">
      <PanelHeader
        value={panel}
        onChange={(v) => set({ leftPanel: v as LeftPanel })}
        onClose={() => set({ leftPanel: null })}
        tabs={[
          { id: 'outline', label: 'Outline' },
          { id: 'pages', label: 'Pages' },
          { id: 'recent', label: 'Recent' }
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel === 'outline' && <Outline editor={editor} />}
        {panel === 'pages' && <Pages editor={editor} tabId={active} />}
        {panel === 'recent' && <Recent />}
      </div>
    </aside>
  )
}

// ---------- right ----------

function FormatPanel({ editor }: { editor: Editor }) {
  const s = useSnapshot(editor)
  const styles = (editor.state.doc.attrs.styles ?? {}) as StyleMap
  return (
    <>
      <Section title="Style">
        <select aria-label="Paragraph style" value={s.styleId} onChange={(e) => applyStyle(editor, e.target.value)} className={inputCls}>
          {Object.values(styles)
            .filter((x) => x.type === 'paragraph')
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </Section>
      <Section title="Paragraph">
        <Segmented
          label="Alignment"
          value={s.align}
          onChange={(v) => updateBlocks(editor, { align: v === 'left' ? null : v })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
            { value: 'justify', label: 'Justify' }
          ]}
        />
        <Row label="Line spacing">
          <NumberInput label="Line spacing" step={0.05} min={0.5} max={5} value={s.lineHeight} onChange={(v) => updateBlocks(editor, { lineHeight: v })} unit="×" />
        </Row>
        <Row label="Space before">
          <NumberInput label="Space before" step={6} min={0} value={s.spaceBefore} onChange={(v) => updateBlocks(editor, { spaceBefore: v })} unit="pt" />
        </Row>
        <Row label="Space after">
          <NumberInput label="Space after" step={6} min={0} value={s.spaceAfter} onChange={(v) => updateBlocks(editor, { spaceAfter: v })} unit="pt" />
        </Row>
      </Section>
      <Section title="Indentation">
        <Row label="Left">
          <NumberInput label="Left indent" step={6} min={0} value={s.indentLeft} onChange={(v) => updateBlocks(editor, { indentLeft: v })} unit="pt" />
        </Row>
        <Row label="Right">
          <NumberInput label="Right indent" step={6} min={0} value={s.indentRight} onChange={(v) => updateBlocks(editor, { indentRight: v })} unit="pt" />
        </Row>
        <Row label="First line">
          <NumberInput label="First line" step={6} value={s.indentFirst} onChange={(v) => updateBlocks(editor, { indentFirst: v })} unit="pt" />
        </Row>
      </Section>
      <Section title="Pagination">
        {(
          [
            ['keepNext', 'Keep with next', 'para.keepNext'],
            ['keepLines', 'Keep lines together', 'para.keepLines'],
            ['pageBreakBefore', 'Page break before', 'para.pageBreakBefore']
          ] as const
        ).map(([k, l, id]) => (
          <label key={k} className="flex items-center gap-2 text-[12.5px] text-text-2">
            <input type="checkbox" checked={s[k]} onChange={() => runCommand(id)} className="accent-[var(--accent)]" />
            {l}
          </label>
        ))}
      </Section>
    </>
  )
}

function PagePanel({ editor }: { editor: Editor }) {
  const page = useEditorState({ editor, selector: ({ editor: e }) => pageOf(e.state.doc) }) ?? pageOf(editor.state.doc)
  const setPage = (p: PageSetup) => editor.chain().command(({ tr }) => (tr.setDocAttribute('page', p), true)).run()
  const m = page.margins
  const setM = (k: keyof PageSetup['margins'], v: number | null) => v != null && v >= 0 && setPage({ ...page, margins: { ...m, [k]: v } })
  const inch = (pt: number) => Math.round((pt / 72) * 100) / 100
  return (
    <>
      <Section title="Paper">
        <select
          aria-label="Paper size"
          value={page.size}
          onChange={(e) => e.target.value !== 'custom' && setPage(withSize(page, e.target.value as keyof typeof PAGE_SIZES))}
          className={inputCls}
        >
          {Object.entries(PAGE_SIZES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label} ({inch(v.width)}″ × {inch(v.height)}″)
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <Row label="Width">
          <NumberInput label="Page width" unit="in" step={0.1} min={1} value={inch(page.width)} onChange={(v) => v && setPage({ ...page, size: 'custom', width: v * 72 })} />
        </Row>
        <Row label="Height">
          <NumberInput label="Page height" unit="in" step={0.1} min={1} value={inch(page.height)} onChange={(v) => v && setPage({ ...page, size: 'custom', height: v * 72 })} />
        </Row>
        <Segmented
          label="Orientation"
          value={page.orientation}
          onChange={(v) => setPage(withOrientation(page, v))}
          options={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' }
          ]}
        />
      </Section>
      <Section title="Margins">
        <select aria-label="Margin preset" value="" onChange={(e) => e.target.value && setPage({ ...page, margins: { ...m, ...MARGIN_PRESETS[e.target.value as keyof typeof MARGIN_PRESETS].margins } })} className={inputCls}>
          <option value="">Preset…</option>
          {Object.entries(MARGIN_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        {(['top', 'bottom', 'left', 'right', 'gutter'] as const).map((k) => (
          <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
            <NumberInput label={`${k} margin`} unit="in" step={0.05} min={0} value={inch(m[k])} onChange={(v) => setM(k, v == null ? null : v * 72)} />
          </Row>
        ))}
      </Section>
      <Section title="Header & footer distance">
        {(['header', 'footer'] as const).map((k) => (
          <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
            <NumberInput label={`${k} distance`} unit="in" step={0.05} min={0} value={inch(m[k])} onChange={(v) => setM(k, v == null ? null : v * 72)} />
          </Row>
        ))}
      </Section>
    </>
  )
}

/** Flesch reading ease with a vowel-group syllable heuristic (English). */
function readability(text: string): number | null {
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length)
  const words = text.match(/[A-Za-z]+/g) ?? []
  if (words.length < 30) return null
  const syllables = words.reduce((n, w) => n + Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length), 0)
  return Math.round(206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length))
}

export function StatsView({ editor }: { editor: Editor }) {
  const st = useStats(editor)
  const pages = usePageInfo(editor).pages
  const score = useMemo(() => readability(editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ')), [editor, st])
  const rows: [string, ReactNode][] = [
    ['Pages', pages],
    ['Words', st.words.toLocaleString()],
    ['Characters (with spaces)', st.chars.toLocaleString()],
    ['Characters (no spaces)', st.charsNoSpaces.toLocaleString()],
    ['Paragraphs', st.paragraphs.toLocaleString()],
    ['Reading time', `${Math.max(1, Math.round(st.words / 238))} min`],
    ['Speaking time', `${Math.max(1, Math.round(st.words / 150))} min`],
    ['Readability (Flesch)', score == null ? '—' : `${score} · ${score >= 70 ? 'Easy' : score >= 50 ? 'Standard' : score >= 30 ? 'Difficult' : 'Very difficult'}`]
  ]
  return (
    <dl className="divide-y divide-border">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between py-2 text-[12.5px]">
          <dt className="text-text-2">{k}</dt>
          <dd className="font-medium tabular-nums text-text">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RightSidebar() {
  const panel = useApp((s) => s.rightPanel)
  const editor = useActiveEditor()
  const body = useBodyEditor()
  if (!panel || !editor || !body) return null
  return (
    <aside aria-label="Properties" className="slide-up flex w-[312px] shrink-0 flex-col border-l border-border bg-panel">
      <PanelHeader
        value={panel}
        onChange={(v) => set({ rightPanel: v as RightPanel })}
        onClose={() => set({ rightPanel: null })}
        tabs={[
          { id: 'format', label: 'Format' },
          { id: 'page', label: 'Page' },
          { id: 'comments', label: 'Comments' },
          { id: 'a11y', label: 'Check' },
          { id: 'stats', label: 'Stats' }
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel === 'format' && <FormatPanel editor={editor} />}
        {panel === 'page' && <PagePanel editor={body} />}
        {panel === 'comments' && <CommentsPanel editor={body} />}
        {panel === 'a11y' && <AccessibilityPanel editor={body} />}
        {panel === 'stats' && (
          <div className="px-4 py-2">
            <StatsView editor={body} />
          </div>
        )}
      </div>
    </aside>
  )
}

// ---------- status bar ----------

function TrackIndicator({ editor }: { editor: Editor }) {
  const on = useEditorState({ editor, selector: ({ editor: e }) => !!e.state.doc.attrs.trackChanges })
  return (
    <button onClick={() => runCommand('review.track')} className={cx('flex h-full items-center gap-1.5 rounded px-2 hover:bg-hover', on && 'font-medium text-accent-ink')} data-testid="track-indicator">
      <span className={cx('size-1.5 rounded-full', on ? 'bg-accent' : 'bg-text-3/50')} />
      Track changes: {on ? 'on' : 'off'}
    </button>
  )
}

export function StatusBar() {
  const editor = useBodyEditor()
  const { zoom, settings, active } = useApp(useShallow((s) => ({ zoom: s.zoom, settings: s.settings, active: s.active })))
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active))
  const info = usePageInfo(editor)
  const st = useStats(editor)
  if (!editor || !tab) return null
  const item = 'flex h-full items-center gap-1.5 px-2 hover:bg-hover hover:text-text rounded'
  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-bg px-2 text-[11.5px] text-text-2" data-testid="status-bar">
      <button className={item} onClick={() => set({ leftPanel: 'pages' })} data-testid="page-indicator">
        Page {info.current} of {info.pages}
      </button>
      <button className={item} onClick={() => set({ dialog: { kind: 'stats' } })} data-testid="word-count">
        {st.words.toLocaleString()} {st.words === 1 ? 'word' : 'words'}
      </button>
      <span className="px-2 tabular-nums">{st.chars.toLocaleString()} characters</span>
      <span className="px-2">{settings.language}</span>
      <span className="px-2" data-testid="spelling-status">
        Spelling: {settings.spellcheck ? 'on' : 'off'}
      </span>
      <div className="flex-1" />
      <TrackIndicator editor={editor} />
      <span className="px-2">{tab.mode === 'source' ? 'Markdown source' : 'Editing'}</span>
      <span className="px-2">{tab.format ? tab.format.toUpperCase() : 'New document'}</span>
      <div className="mx-1 h-3.5 w-px bg-border" />
      <IconBtn label="Zoom out" size="sm" onClick={() => runCommand('view.zoomOut')}>
        <Minus className="size-3" />
      </IconBtn>
      <input
        type="range"
        aria-label="Zoom"
        min={25}
        max={300}
        step={5}
        value={Math.round(zoom * 100)}
        onChange={(e) => zoomTo(Number(e.target.value) / 100)}
        className="h-1 w-24 cursor-pointer accent-[var(--accent)]"
      />
      <IconBtn label="Zoom in" size="sm" onClick={() => runCommand('view.zoomIn')}>
        <Plus className="size-3" />
      </IconBtn>
      <button className={cx(item, 'w-11 justify-center tabular-nums')} onClick={() => zoomTo(1)} title="Reset to 100%" data-testid="zoom-level">
        {Math.round(zoom * 100)}%
      </button>
      <button className={item} onClick={() => set({ rightPanel: 'stats' })} aria-label="Statistics" data-active={active}>
        <BookOpenText className="size-3.5" />
      </button>
    </footer>
  )
}

