import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Info, Monitor, Moon, Sun } from 'lucide-react'
import { useApp, set, get, editors, updateSettings, type Dialog } from '../state/store'
import * as docs from '../state/documents'
import { allCommands, applyStyle, eventToShortcut, formatShortcut, shortcutFor } from './commands'
import { resolveStyle, type ParaProps, type RunProps, type StyleDef, type StyleMap } from '@/editor/model'
import { saveStyle, uniqueStyleId } from '@/editor/style-ops'
import { fontStack } from '@/editor/styles-css'
import { StatsView } from './Panels'
import { Btn, Field, Kbd, Modal, Segmented, Switch, cx, inputCls } from '../ui'
import { FORMAT_LABELS } from '@/formats/types'
import type { Settings } from '@/shared/ipc-types'
import { refreshSpelling, resetSpelling } from '../spell/client'
import { HistoryDialog } from './History'

const close = () => set({ dialog: null })

export function Dialogs() {
  const d = useApp((s) => s.dialog)
  if (!d) return null
  switch (d.kind) {
    case 'settings':
      return <SettingsDialog />
    case 'confirm-close':
      return <ConfirmClose d={d} />
    case 'link':
      return <LinkDialog />
    case 'compat':
      return <CompatDialog tabId={d.tabId} />
    case 'shortcuts':
      return <ShortcutsDialog />
    case 'stats':
      return <StatsDialog />
    case 'export-warnings':
      return <ExportWarnings d={d} />
    case 'style':
      return <StyleDialog styleId={d.styleId} />
    case 'pdf-password':
      return <PdfPasswordDialog d={d} />
    case 'history':
      return <HistoryDialog />
    default:
      return null
  }
}

function ConfirmClose({ d }: { d: Extract<Dialog, { kind: 'confirm-close' }> }) {
  const tabs = useApp((s) => s.tabs.filter((t) => d.tabIds.includes(t.id)))
  const many = tabs.length > 1
  const finish = () => {
    close()
    if (d.then === 'quit') docs.quitNow()
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={many ? `Save changes to ${tabs.length} documents?` : `Save changes to “${tabs[0]?.title}”?`}
      description="Your changes will be lost if you don’t save them."
      width={440}
      footer={
        <>
          <Btn
            variant="ghost"
            onClick={() => {
              tabs.forEach((t) => docs.closeTab(t.id, true))
              finish()
            }}
          >
            Don’t save
          </Btn>
          <Btn onClick={close}>Cancel</Btn>
          <Btn
            variant="primary"
            autoFocus
            onClick={async () => {
              for (const t of tabs) {
                docs.activate(t.id)
                if (!(await docs.save(t.id))) return
                docs.closeTab(t.id, true)
              }
              finish()
            }}
          >
            Save
          </Btn>
        </>
      }
    >
      {many && (
        <ul className="space-y-1 text-[13px] text-text-2">
          {tabs.map((t) => (
            <li key={t.id}>• {t.title}</li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function PdfPasswordDialog({ d }: { d: Extract<Dialog, { kind: 'pdf-password' }> }) {
  const [pw, setPw] = useState('')
  const submit = () => {
    close()
    void docs.openPdf(d.file, pw)
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Password required"
      description={`${d.file.name} is protected. Enter its password to open it. It stays protected with the same password when you save.`}
      width={420}
      footer={
        <>
          <Btn onClick={close}>Cancel</Btn>
          <Btn variant="primary" disabled={!pw} onClick={submit}>
            Open
          </Btn>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), pw && submit())}>
        <input autoFocus type="password" aria-label="PDF password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
        {d.wrong && <p className="mt-2 text-[12px] text-danger">That password is not correct.</p>}
      </form>
    </Modal>
  )
}

function LinkDialog() {
  const editor = editors.get(get().active)
  const existing = (editor?.getAttributes('link').href as string) ?? ''
  const sel = editor?.state.selection
  const [href, setHref] = useState(existing)
  const [text, setText] = useState(sel && !sel.empty ? editor!.state.doc.textBetween(sel.from, sel.to, ' ') : '')
  if (!editor) return null
  const normalized = /^(https?:|mailto:|#)/i.test(href) ? href : href.includes('@') && !href.includes('/') ? `mailto:${href}` : href ? `https://${href}` : ''
  const apply = () => {
    if (!normalized) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (sel?.empty && !existing) editor.chain().focus().insertContent({ type: 'text', text: text || href, marks: [{ type: 'link', attrs: { href: normalized } }] }).run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run()
    close()
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={existing ? 'Edit link' : 'Insert link'}
      width={440}
      footer={
        <>
          {existing && (
            <Btn
              variant="ghost"
              className="mr-auto text-danger"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                close()
              }}
            >
              Remove link
            </Btn>
          )}
          <Btn onClick={close}>Cancel</Btn>
          <Btn variant="primary" onClick={apply}>
            {existing ? 'Update' : 'Insert'}
          </Btn>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        {sel?.empty && !existing && (
          <Field label="Text to display">
            <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <Field label="Address" hint="Web address, email address, or #bookmark">
          <input autoFocus className={inputCls} value={href} placeholder="https://example.com" onChange={(e) => setHref(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function CompatDialog({ tabId }: { tabId: string }) {
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId))
  if (!tab) return null
  const loss = tab.warnings.filter((w) => w.level === 'loss')
  const info = tab.warnings.filter((w) => w.level === 'info')
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Compatibility report"
      description={tab.format ? `${tab.title} · ${FORMAT_LABELS[tab.format]}` : tab.title}
      width={560}
      footer={
        <Btn variant="primary" onClick={close}>
          Done
        </Btn>
      }
    >
      {!tab.warnings.length && <p className="text-[13px] text-text-2">No compatibility issues were found when this file was opened.</p>}
      {loss.length > 0 && (
        <WarningList title="Preserved or changed" icon={<AlertTriangle className="size-4 text-warn" />} items={loss}>
          Some content in this file is preserved as-is but cannot be edited yet, or is shown differently. Saving back to the same format keeps preserved content.
          {tab.autosaveBlocked && ' AutoSave is paused for this document until you save it yourself.'}
        </WarningList>
      )}
      {info.length > 0 && <WarningList title="Notes" icon={<Info className="size-4 text-text-3" />} items={info} />}
    </Modal>
  )
}

function WarningList({ title, icon, items, children }: { title: string; icon: ReactNode; items: { message: string; count?: number }[]; children?: ReactNode }) {
  return (
    <section className="mb-4">
      <h4 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
        {icon}
        {title}
      </h4>
      {children && <p className="mb-2 text-[12.5px] leading-relaxed text-text-2">{children}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((w) => (
          <li key={w.message} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
            <span>{w.message}</span>
            {w.count && w.count > 1 && <span className="shrink-0 rounded-full bg-hover px-2 text-[11px] text-text-3">×{w.count}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ExportWarnings({ d }: { d: Extract<Dialog, { kind: 'export-warnings' }> }) {
  const done = (ok: boolean) => {
    close()
    d.resolve(ok)
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && done(false)}
      title={`Some content can’t be saved as ${FORMAT_LABELS[d.format]}`}
      description="The file will be written, but these parts of your document will be simplified or left out. Keep a DOCX copy to preserve everything."
      width={540}
      footer={
        <>
          <Btn onClick={() => done(false)}>Cancel</Btn>
          <Btn variant="primary" autoFocus onClick={() => done(true)}>
            Save anyway
          </Btn>
        </>
      }
    >
      <WarningList title="What changes" icon={<AlertTriangle className="size-4 text-warn" />} items={d.warnings} />
    </Modal>
  )
}

function StyleDialog({ styleId }: { styleId: string | null }) {
  const editor = editors.get(get().active)
  const styles = (editor?.state.doc.attrs.styles ?? {}) as StyleMap
  const existing = styleId ? styles[styleId] : null
  const resolved = resolveStyle(styles, existing ? existing.id : 'Normal')
  const [name, setName] = useState(existing?.name ?? 'New style')
  const [basedOn, setBasedOn] = useState(existing?.basedOn ?? (existing ? '' : 'Normal'))
  const [next, setNext] = useState(existing?.next ?? '')
  const [run, setRun] = useState<RunProps>({ ...(existing ? existing.run : {}) })
  const [para, setPara] = useState<ParaProps>({ ...(existing ? existing.para : {}) })
  if (!editor) return null
  const eff = { run: { ...resolved.run, ...run }, para: { ...resolved.para, ...para } }
  const paraStyles = Object.values(styles).filter((s) => s.type === 'paragraph' && s.id !== existing?.id)
  const save = () => {
    const id = existing?.id ?? uniqueStyleId(styles, name)
    const def: StyleDef = { ...(existing ?? { type: 'paragraph' as const }), id, name: existing?.builtin ? existing.name : name.trim() || id, basedOn: id === 'Normal' ? undefined : basedOn || 'Normal', next: next || undefined, run, para }
    saveStyle(editor, def)
    if (!existing) applyStyle(editor, id)
    close()
  }
  const num = (v: string) => (v === '' ? undefined : Number(v))
  const field = 'h-8 rounded-lg border border-border bg-panel px-2 text-[13px] outline-none focus:border-accent'
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={existing ? `Modify style: ${existing.name}` : 'New paragraph style'}
      description="Changes apply to every paragraph that uses this style."
      width={600}
      footer={
        <>
          <Btn onClick={close}>Cancel</Btn>
          <Btn variant="primary" onClick={save} data-testid="style-save">
            {existing ? 'Save style' : 'Create style'}
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name">
          <input className={cx(field, 'w-full')} value={name} disabled={!!existing?.builtin} onChange={(e) => setName(e.target.value)} aria-label="Style name" />
        </Field>
        <Field label="Based on">
          <select className={cx(field, 'w-full')} value={basedOn} disabled={existing?.id === 'Normal'} onChange={(e) => setBasedOn(e.target.value)}>
            {paraStyles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Next paragraph">
          <select className={cx(field, 'w-full')} value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="">Same style</option>
            {Object.values(styles)
              .filter((s) => s.type === 'paragraph')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-3">Font</h4>
      <div className="flex flex-wrap items-end gap-2">
        <input className={cx(field, 'w-44')} list="sd-fonts" value={eff.run.fontFamily ?? ''} onChange={(e) => setRun({ ...run, fontFamily: e.target.value || undefined })} aria-label="Font" />
        <datalist id="sd-fonts">
          {['Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Liberation Sans', 'Liberation Serif'].map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <input className={cx(field, 'w-20')} type="number" step={0.5} min={4} value={eff.run.fontSize ?? ''} onChange={(e) => setRun({ ...run, fontSize: num(e.target.value) })} aria-label="Font size" />
        {(['bold', 'italic', 'underline'] as const).map((k) => (
          <button key={k} onClick={() => setRun({ ...run, [k]: !eff.run[k] })} aria-pressed={!!eff.run[k]} className={cx(field, 'w-9 font-serif', eff.run[k] && 'border-accent bg-accent-soft text-accent', k === 'bold' && 'font-bold', k === 'italic' && 'italic', k === 'underline' && 'underline')}>
            {k[0].toUpperCase()}
          </button>
        ))}
        <input type="color" aria-label="Text color" value={eff.run.color ?? '#000000'} onChange={(e) => setRun({ ...run, color: e.target.value })} className="h-8 w-10 cursor-pointer rounded-lg border border-border bg-panel p-1" />
      </div>
      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-3">Paragraph</h4>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Alignment"
          value={eff.para.align ?? 'left'}
          onChange={(v) => setPara({ ...para, align: v })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
            { value: 'justify', label: 'Justify' }
          ]}
        />
        {(
          [
            ['lineHeight', 'Line spacing', '×', 0.05],
            ['spaceBefore', 'Before', 'pt', 1],
            ['spaceAfter', 'After', 'pt', 1],
            ['indentLeft', 'Indent', 'pt', 6],
            ['indentFirst', 'First line', 'pt', 6]
          ] as const
        ).map(([k, l, unit, step]) => (
          <label key={k} className="flex items-center gap-1.5 text-[12px] text-text-2">
            {l}
            <input className={cx(field, 'w-16')} type="number" step={step} value={(eff.para[k] as number | undefined) ?? ''} onChange={(e) => setPara({ ...para, [k]: num(e.target.value) })} aria-label={l} />
            <span className="text-text-3">{unit}</span>
          </label>
        ))}
        {(
          [
            ['keepNext', 'Keep with next'],
            ['keepLines', 'Keep lines together']
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5 text-[12px] text-text-2">
            <input type="checkbox" checked={!!eff.para[k]} onChange={(e) => setPara({ ...para, [k]: e.target.checked })} className="accent-[var(--accent)]" />
            {l}
          </label>
        ))}
      </div>
      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-3">Preview</h4>
      <div className="rounded-lg border border-border bg-white p-4 text-black" style={{ textAlign: eff.para.align ?? 'left' }}>
        <p
          style={{
            fontFamily: eff.run.fontFamily ? fontStack(eff.run.fontFamily) : undefined,
            fontSize: `${eff.run.fontSize ?? 11}pt`,
            fontWeight: eff.run.bold ? 700 : 400,
            fontStyle: eff.run.italic ? 'italic' : 'normal',
            textDecoration: eff.run.underline ? 'underline' : 'none',
            color: eff.run.color,
            lineHeight: (eff.para.lineHeight ?? 1.15) * 1.2,
            marginLeft: `${eff.para.indentLeft ?? 0}pt`,
            textIndent: `${eff.para.indentFirst ?? 0}pt`
          }}
        >
          The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.
        </p>
      </div>
    </Modal>
  )
}

function StatsDialog() {
  const editor = editors.get(get().active) // body editor, even while a header is open
  if (!editor) return null
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Word count"
      width={380}
      footer={
        <Btn variant="primary" onClick={close}>
          Close
        </Btn>
      }
    >
      <StatsView editor={editor} />
    </Modal>
  )
}

function ShortcutsDialog() {
  const shortcuts = useApp((s) => s.settings.shortcuts)
  const [recording, setRecording] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key !== 'Escape') void updateSettings({ shortcuts: { ...get().settings.shortcuts, [recording]: eventToShortcut(e) } })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])
  const cmds = allCommands().filter((c) => c.label.toLowerCase().includes(q.toLowerCase()) && !c.id.endsWith('Alt'))
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title="Keyboard shortcuts"
      description="Click a shortcut to change it. Press Esc to cancel."
      width={560}
      footer={
        <>
          <Btn variant="ghost" className="mr-auto" onClick={() => updateSettings({ shortcuts: {} })}>
            Reset all
          </Btn>
          <Btn variant="primary" onClick={close}>
            Done
          </Btn>
        </>
      }
    >
      <input className={cx(inputCls, 'mb-3')} placeholder="Search commands" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commands" />
      <div className="divide-y divide-border">
        {cmds.map((c) => {
          const sc = shortcutFor(c.id)
          return (
            <div key={c.id} className="flex h-9 items-center justify-between text-[13px]">
              <span>{c.label}</span>
              <button onClick={() => setRecording(c.id)} className={cx('min-w-24 rounded-md px-2 py-1 text-right hover:bg-hover', recording === c.id && 'bg-accent-soft text-accent')}>
                {recording === c.id ? 'Press keys…' : sc ? <Kbd>{formatShortcut(sc)}</Kbd> : <span className="text-[12px] text-text-3">Add</span>}
                {shortcuts[c.id] && recording !== c.id && <span className="ml-1 text-[10px] text-accent">●</span>}
              </button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-3 last:border-0">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-text-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

const ACCENTS = ['#5b5bd6', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#3f3f46']
const FONTS = ['Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Georgia', 'Liberation Sans', 'Liberation Serif']

function SettingsDialog() {
  const s = useApp((x) => x.settings)
  const lo = useApp((x) => x.libreOffice)
  const [section, setSection] = useState('appearance')
  const up = (p: Partial<Settings>) => void updateSettings(p)
  const sections = [
    ['appearance', 'Appearance'],
    ['editor', 'Editor'],
    ['documents', 'New documents'],
    ['saving', 'Saving & recovery'],
    ['privacy', 'Privacy & formats']
  ]
  return (
    <Modal open onOpenChange={(o) => !o && close()} title="Settings" width={720}>
      <div className="-mx-6 -my-3 flex min-h-[420px]">
        <nav className="w-[180px] shrink-0 border-r border-border p-2">
          {sections.map(([id, label]) => (
            <button key={id} onClick={() => setSection(id)} className={cx('block h-8 w-full rounded-md px-3 text-left text-[13px]', section === id ? 'bg-accent-soft font-medium text-accent' : 'text-text-2 hover:bg-hover')}>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 px-6 py-2">
          {section === 'appearance' && (
            <>
              <Row label="Theme">
                <Segmented
                  label="Theme"
                  value={s.theme}
                  onChange={(theme) => up({ theme })}
                  options={[
                    { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
                    { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
                    { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-3.5" />System</span> }
                  ]}
                />
              </Row>
              <Row label="Accent color">
                <div className="flex gap-1.5">
                  {ACCENTS.map((c) => (
                    <button key={c} aria-label={c} onClick={() => up({ accent: c })} className={cx('size-6 rounded-full transition-transform hover:scale-110', s.accent === c && 'ring-2 ring-offset-2 ring-offset-elev')} style={{ background: c, ['--tw-ring-color' as string]: c }} />
                  ))}
                </div>
              </Row>
              <Row label="Interface size" hint="Scales the whole interface">
                <Segmented label="Interface size" value={String(s.uiScale)} onChange={(v) => up({ uiScale: Number(v) })} options={[{ value: '0.9', label: 'Compact' }, { value: '1', label: 'Default' }, { value: '1.1', label: 'Large' }, { value: '1.25', label: 'Larger' }]} />
              </Row>
              <Row label="Reduce motion" hint="Minimize animations and transitions">
                <Switch label="Reduce motion" checked={s.reduceMotion} onChange={(reduceMotion) => up({ reduceMotion })} />
              </Row>
            </>
          )}
          {section === 'editor' && (
            <>
              <Row label="Show ruler">
                <Switch label="Show ruler" checked={s.showRuler} onChange={(showRuler) => up({ showRuler })} />
              </Row>
              <Row label="Collapse ribbon by default">
                <Switch label="Collapse ribbon" checked={s.ribbonCollapsed} onChange={(ribbonCollapsed) => up({ ribbonCollapsed })} />
              </Row>
              <Row label="Spell checking" hint="Offline. English (US/UK) is built in; other languages use Hunspell dictionaries installed on this computer.">
                <Switch
                  label="Spell checking"
                  checked={s.spellcheck}
                  onChange={(spellcheck) => {
                    up({ spellcheck })
                    setTimeout(refreshSpelling, 50)
                  }}
                />
              </Row>
              <Row label="Proofing language">
                <select
                  className={cx(inputCls, 'w-40')}
                  value={s.language}
                  onChange={(e) => {
                    up({ language: e.target.value })
                    setTimeout(resetSpelling, 50)
                  }}
                >
                  {['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'pt-BR', 'nl-NL'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </Row>
              <Row label="Custom dictionary" hint={s.customWords.length ? s.customWords.slice(0, 12).join(', ') + (s.customWords.length > 12 ? '…' : '') : 'Words you add from the right-click menu appear here'}>
                <Btn size="sm" disabled={!s.customWords.length} onClick={() => (up({ customWords: [] }), setTimeout(resetSpelling, 50))}>
                  Clear
                </Btn>
              </Row>
              <Row label="Keyboard shortcuts">
                <Btn size="sm" onClick={() => set({ dialog: { kind: 'shortcuts' } })}>
                  Customize…
                </Btn>
              </Row>
              <Row label="Author name" hint="Saved in document properties">
                <input className={cx(inputCls, 'w-48')} value={s.authorName} onChange={(e) => up({ authorName: e.target.value })} />
              </Row>
            </>
          )}
          {section === 'documents' && (
            <>
              <Row label="Default font">
                <select className={cx(inputCls, 'w-44')} value={s.defaultFont} onChange={(e) => up({ defaultFont: e.target.value })}>
                  {FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Row>
              <Row label="Default font size">
                <select className={cx(inputCls, 'w-24')} value={s.defaultFontSize} onChange={(e) => up({ defaultFontSize: Number(e.target.value) })}>
                  {[9, 10, 10.5, 11, 12, 13, 14].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Row>
              <Row label="Page size">
                <Segmented label="Page size" value={s.defaultPageSize} onChange={(defaultPageSize) => up({ defaultPageSize })} options={[{ value: 'letter', label: 'Letter' }, { value: 'a4', label: 'A4' }, { value: 'legal', label: 'Legal' }, { value: 'a3', label: 'A3' }]} />
              </Row>
              <Row label="Margins">
                <Segmented label="Margins" value={s.defaultMargins} onChange={(defaultMargins) => up({ defaultMargins })} options={[{ value: 'normal', label: 'Normal' }, { value: 'narrow', label: 'Narrow' }, { value: 'moderate', label: 'Moderate' }, { value: 'wide', label: 'Wide' }]} />
              </Row>
              <Row label="Default save format">
                <select className={cx(inputCls, 'w-48')} value={s.defaultSaveFormat} onChange={(e) => up({ defaultSaveFormat: e.target.value as Settings['defaultSaveFormat'] })}>
                  {(['docx', 'odt', 'md', 'html', 'txt'] as const).map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
          {section === 'saving' && (
            <>
              <Row label="AutoSave" hint="Saves documents that already have a file location. Paused for files with compatibility warnings until you save manually.">
                <Switch label="AutoSave" checked={s.autosave} onChange={(autosave) => up({ autosave })} />
              </Row>
              <Row label="AutoSave delay" hint="Seconds after your last edit">
                <select className={cx(inputCls, 'w-28')} value={s.autosaveIntervalSec} onChange={(e) => up({ autosaveIntervalSec: Number(e.target.value) })}>
                  {[5, 15, 30, 60, 120, 300].map((v) => (
                    <option key={v} value={v}>
                      {v < 60 ? `${v} sec` : `${v / 60} min`}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Recovery snapshots" hint="Unsaved work is snapshotted locally and offered back after a crash">
                <select className={cx(inputCls, 'w-28')} value={s.recoveryIntervalSec} onChange={(e) => up({ recoveryIntervalSec: Number(e.target.value) })}>
                  {[2, 5, 10, 30].map((v) => (
                    <option key={v} value={v}>
                      {v} sec
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
          {section === 'privacy' && (
            <div className="space-y-3 py-3 text-[13px] leading-relaxed text-text-2">
              <p>
                <strong className="text-text">Simple Docs works fully offline.</strong> It makes no network requests, has no account, and sends no telemetry. Documents, settings and recovery snapshots stay on this computer.
              </p>
              <p>Links you open from a document go to your default browser.</p>
              <div className="rounded-lg border border-border p-3">
                <div className="font-medium text-text">LibreOffice converter</div>
                <div className="mt-1">{lo ? 'Detected — ODT, RTF and legacy DOC files can be opened and saved.' : 'Not found — install LibreOffice to open and save ODT, RTF and legacy DOC files. DOCX, Markdown, HTML, text and PDF export work without it.'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
