import { useMemo, useState } from 'react'
import { History, ArrowLeft, Clock, FileDown, FilePlus2, FileText, FolderOpen, LifeBuoy, MoreHorizontal, Pin, PinOff, Printer, Save, SaveAll, Search, Star, Trash2, X, Info } from 'lucide-react'
import { useApp, set, activeTab, editors } from '../state/store'
import * as docs from '../state/documents'
import { TEMPLATES } from '@/editor/templates'
import { emptyDoc } from '@/editor/create'
import type { RecentFile } from '@/shared/ipc-types'
import { runCommand, shortcutFor, formatShortcut } from './commands'
import { Logo } from './TitleBar'
import { Btn, IconBtn, Kbd, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, cx } from '../ui'

function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(ts).toLocaleDateString()
}

function TemplateCard({ t }: { t: (typeof TEMPLATES)[number] }) {
  return (
    <button
      onClick={() => docs.newDocument(emptyDoc({}, t.build()), t.id === 'blank' ? undefined : t.name)}
      className="group flex w-[148px] shrink-0 flex-col text-left"
      data-testid={`template-${t.id}`}
    >
      <div className="relative aspect-[1/1.294] w-full overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-accent group-hover:shadow-[0_10px_24px_-10px_rgb(40_40_90/0.35)]">
        {t.id === 'blank' ? (
          <div className="flex h-full items-center justify-center">
            <FilePlus2 className="size-7 text-zinc-300 transition-colors group-hover:text-accent-ink" />
          </div>
        ) : (
          <div className="space-y-[5px] p-4">
            <div className="h-2 w-2/3 rounded-sm" style={{ background: t.accent }} />
            <div className="h-1 w-1/3 rounded-sm bg-zinc-300" />
            <div className="pt-2" />
            {[90, 100, 84, 96, 70, 0, 60, 100, 92, 80].map((w, i) => (w ? <div key={i} className="h-[3px] rounded-sm bg-zinc-200" style={{ width: `${w}%` }} /> : <div key={i} className="h-1.5 w-2/5 rounded-sm" style={{ background: t.accent, opacity: 0.55 }} />))}
          </div>
        )}
      </div>
      <div className="mt-2 px-0.5 text-[12.5px] font-medium text-text">{t.name}</div>
      <div className="px-0.5 text-[11.5px] leading-snug text-text-3">{t.description}</div>
    </button>
  )
}

function RecentCard({ r }: { r: RecentFile }) {
  const ext = r.name.split('.').pop()?.toUpperCase()
  return (
    <div className="group relative">
      <button onClick={() => docs.openPath(r.path)} className="flex w-full flex-col text-left" title={r.path}>
        <div className="aspect-[1/1.1] w-full overflow-hidden rounded-xl border border-border bg-panel-2 transition-all duration-200 group-hover:border-border-strong group-hover:shadow-[0_8px_20px_-10px_rgb(0_0_0/0.25)]">
          {r.thumbnail ? (
            <img src={r.thumbnail} alt="" className="h-full w-full object-cover object-top" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <FileText className="size-8 text-text-3 opacity-50" />
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5 px-0.5">
          {r.pinned && <Pin className="size-3 shrink-0 text-accent-ink" />}
          <span className="truncate text-[12.5px] font-medium text-text">{r.name.replace(/\.[^.]+$/, '')}</span>
        </div>
        <div className="px-0.5 text-[11.5px] text-text-3">
          {ext} · {ago(r.openedAt)}
        </div>
      </button>
      <Menu>
        <MenuTrigger asChild>
          <button aria-label="More" className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg bg-elev/90 text-text-2 opacity-0 shadow-sm backdrop-blur transition-opacity hover:text-text group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<FolderOpen />} onSelect={() => docs.openPath(r.path)}>
            Open
          </MenuItem>
          <MenuItem icon={r.pinned ? <PinOff /> : <Pin />} onSelect={async () => set({ recents: await window.simpleDocs.recentUpdate(r.path, { pinned: !r.pinned }) })}>
            {r.pinned ? 'Unpin' : 'Pin to top'}
          </MenuItem>
          <MenuItem icon={<Star />} onSelect={async () => set({ recents: await window.simpleDocs.recentUpdate(r.path, { favorite: !r.favorite }) })}>
            {r.favorite ? 'Remove from favorites' : 'Add to favorites'}
          </MenuItem>
          <MenuSep />
          <MenuItem icon={<Trash2 />} onSelect={async () => set({ recents: await window.simpleDocs.recentRemove(r.path) })}>
            Remove from list
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

export function Dashboard() {
  const recents = useApp((s) => s.recents)
  const recovery = useApp((s) => s.recovery)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'pinned' | 'favorites'>('all')
  const list = useMemo(
    () =>
      recents
        .filter((r) => (filter === 'pinned' ? r.pinned : filter === 'favorites' ? r.favorite : true))
        .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.path.toLowerCase().includes(q.toLowerCase())),
    [recents, q, filter]
  )
  const hour = new Date().getHours()
  return (
    <div className="h-full overflow-y-auto bg-bg" data-testid="dashboard">
      <div className="mx-auto max-w-[1080px] px-10 pb-16 pt-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.025em]">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</h1>
            <p className="mt-1 text-[13.5px] text-text-2">Start something new or pick up where you left off.</p>
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => runCommand('file.open')}>
              <FolderOpen className="size-4" />
              Open
              <span className="ml-1 text-[11px] text-text-3">{formatShortcut(shortcutFor('file.open'))}</span>
            </Btn>
            <Btn variant="primary" onClick={() => runCommand('file.new')} data-testid="new-doc">
              <FilePlus2 className="size-4" />
              New document
            </Btn>
          </div>
        </div>

        {recovery.length > 0 && (
          <div className="slide-up mt-7 rounded-2xl border border-warn/40 bg-warn/[0.06] p-4" data-testid="recovery">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <LifeBuoy className="size-4 text-warn" />
              Recovered documents
            </div>
            <p className="mt-1 text-[12.5px] text-text-2">Simple Docs closed unexpectedly. These unsaved changes were recovered.</p>
            <div className="mt-3 space-y-1.5">
              {recovery.map((r) => {
                let title = 'Untitled'
                try {
                  title = (JSON.parse(r.payload) as { title: string }).title
                } catch {
                  /* damaged */
                }
                return (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2 shadow-[0_0_0_1px_var(--border)]">
                    <FileText className="size-4 text-text-3" />
                    <span className="flex-1 text-[13px] font-medium">{title}</span>
                    <span className="text-[12px] text-text-3">{ago(r.savedAt)}</span>
                    <Btn size="sm" variant="ghost" onClick={() => docs.discardRecovery(r.id)}>
                      Discard
                    </Btn>
                    <Btn size="sm" variant="primary" onClick={() => docs.restoreRecovery(r)}>
                      Restore
                    </Btn>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <section className="mt-9">
          <h2 className="mb-3 text-[13px] font-semibold text-text-2">Start a new document</h2>
          <div className="flex gap-5 overflow-x-auto pb-2">
            {TEMPLATES.map((t) => (
              <TemplateCard key={t.id} t={t} />
            ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-[13px] font-semibold text-text-2">Recent</h2>
            <div className="flex gap-1">
              {(['all', 'pinned', 'favorites'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={cx('h-7 rounded-full px-3 text-[12px] font-medium capitalize transition-colors', filter === f ? 'bg-text text-bg' : 'text-text-2 hover:bg-hover')}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recent files" aria-label="Search recent files" className="h-8 w-full rounded-lg border border-border bg-panel pl-8 pr-3 text-[12.5px] outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]" />
            </div>
          </div>
          {list.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
              {list.map((r) => (
                <RecentCard key={r.path} r={r} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong py-14 text-center">
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-hover">
                <Clock className="size-5 text-text-3" />
              </div>
              <div className="text-[13.5px] font-medium">{recents.length ? 'No matching files' : 'No recent documents'}</div>
              <p className="mt-1 max-w-sm text-[12.5px] text-text-3">{recents.length ? 'Try a different search or filter.' : 'Open a DOCX, ODT, Markdown, HTML or text file — or drop one anywhere in this window.'}</p>
            </div>
          )}
        </section>
        <div className="mt-12 flex items-center justify-center gap-2 text-[12px] text-text-3">
          <Logo size={16} />
          Simple Docs · works offline · <Kbd>{formatShortcut(shortcutFor('tools.shortcuts'))}</Kbd> for shortcuts
        </div>
      </div>
    </div>
  )
}

/** File tab "backstage": full-height overlay with document actions. */
export function Backstage() {
  const open = useApp((s) => s.backstage)
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active))
  if (!open || !tab) return null
  const item = (icon: React.ReactNode, label: string, onClick: () => void, sc?: string) => (
    <button onClick={() => (set({ backstage: false }), onClick())} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px] text-text hover:bg-hover">
      <span className="text-text-2 [&>svg]:size-[18px]">{icon}</span>
      <span className="flex-1">{label}</span>
      {sc && <span className="text-[11.5px] text-text-3">{formatShortcut(shortcutFor(sc))}</span>}
    </button>
  )
  return (
    <div className="fade-in absolute inset-0 z-40 flex bg-bg">
      <nav className="w-[260px] shrink-0 border-r border-border bg-panel p-3">
        <button onClick={() => set({ backstage: false })} className="mb-3 flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] text-text-2 hover:bg-hover">
          <ArrowLeft className="size-4" /> Back to document
        </button>
        {item(<FilePlus2 />, 'New', () => runCommand('file.new'), 'file.new')}
        {item(<FolderOpen />, 'Open…', () => runCommand('file.open'), 'file.open')}
        <div className="my-2 h-px bg-border" />
        {item(<Save />, 'Save', () => runCommand('file.save'), 'file.save')}
        {item(<SaveAll />, 'Save as…', () => runCommand('file.saveAs'), 'file.saveAs')}
        {item(<FileDown />, 'Export as PDF…', () => runCommand('file.exportPdf'), 'file.exportPdf')}
        {item(<Printer />, 'Print…', () => runCommand('file.print'), 'file.print')}
        <div className="my-2 h-px bg-border" />
        {item(<History />, 'Version history…', () => runCommand('file.history'))}
        {item(<Info />, 'Compatibility report', () => runCommand('tools.compat'))}
        {item(<X />, 'Close document', () => runCommand('file.close'), 'file.close')}
      </nav>
      <div className="flex-1 overflow-y-auto px-12 py-10">
        <h1 className="text-[22px] font-semibold tracking-tight">{tab.title}</h1>
        <p className="mt-1 text-[13px] text-text-3">{tab.path ?? 'Not saved yet'}</p>
        <Properties />
      </div>
      <IconBtn label="Close" className="absolute right-4 top-4" onClick={() => set({ backstage: false })}>
        <X className="size-4" />
      </IconBtn>
    </div>
  )
}

function Properties() {
  const tab = activeTab()
  const active = useApp((s) => s.active)
  const [, force] = useState(0)
  const editor = editors.get(active)
  if (!editor || !tab) return null
  const meta = (editor.state.doc.attrs.meta ?? {}) as Record<string, string | undefined>
  const setMeta = (k: string, v: string) => {
    editor.chain().command(({ tr }) => (tr.setDocAttribute('meta', { ...meta, [k]: v || undefined }), true)).run()
    force((n) => n + 1)
  }
  const fields: [string, string][] = [
    ['title', 'Title'],
    ['subject', 'Subject'],
    ['author', 'Author'],
    ['keywords', 'Keywords'],
    ['description', 'Comments']
  ]
  return (
    <section className="mt-8 max-w-xl">
      <h2 className="mb-3 text-[13px] font-semibold text-text-2">Document properties</h2>
      <div className="space-y-3 rounded-xl border border-border bg-panel p-4">
        {fields.map(([k, l]) => (
          <label key={k} className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-[12.5px] text-text-2">{l}</span>
            <input defaultValue={meta[k] ?? ''} onBlur={(e) => setMeta(k, e.target.value)} className="h-8 rounded-lg border border-border bg-panel px-2.5 text-[13px] outline-none focus:border-accent" />
          </label>
        ))}
        <div className="grid grid-cols-[110px_1fr] gap-3 text-[12.5px]">
          <span className="text-text-2">Format</span>
          <span>{tab.format?.toUpperCase() ?? 'Not saved'}</span>
          <span className="text-text-2">Created</span>
          <span>{meta.created ? new Date(meta.created).toLocaleString() : '—'}</span>
        </div>
      </div>
    </section>
  )
}
