import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Cloud, Download, FileText, Home, Loader2, Minus, Moon, Plus, Redo2, Save, Search, Settings, Square, Sun, Undo2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { HOME, useApp, set, type TabMeta } from '../state/store'
import * as docs from '../state/documents'
import { runCommand, shortcutFor } from './commands'
import { useActiveEditor, useSnapshot } from './hooks'
import { Btn, IconBtn, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, Tip, cx } from '../ui'

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="sd-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--accent) 55%, #1b1b3a)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#sd-logo)" />
      <path d="M10 9.5h8.5l3.5 3.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 9 22.5v-11.5A1.5 1.5 0 0 1 10.5 9.5Z" fill="#fff" fillOpacity=".96" />
      <path d="M18.5 9.5V12a1 1 0 0 0 1 1H22Z" fill="color-mix(in oklab, var(--accent) 35%, #fff)" />
      <path d="M12 16.5h7M12 19h7M12 21.5h4.5" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function useOverlayInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const wco = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void } }).windowControlsOverlay
    if (!wco) return
    const update = () => setInset(wco.visible ? Math.max(0, window.innerWidth - wco.getTitlebarAreaRect().right) : 0)
    update()
    wco.addEventListener('geometrychange', update)
    return () => wco.removeEventListener('geometrychange', update)
  }, [])
  return inset
}

function SaveStatus({ tab }: { tab: TabMeta }) {
  const s = tab.status
  const label = s === 'saving' ? 'Saving…' : s === 'error' ? 'Save failed' : s === 'unsaved' ? (tab.path ? 'Edited' : 'Not saved') : tab.path ? 'Saved' : 'New'
  const icon = s === 'saving' ? <Loader2 className="size-3.5 animate-spin" /> : s === 'error' ? <AlertTriangle className="size-3.5" /> : s === 'saved' && tab.path ? <Check className="size-3.5" /> : <Cloud className="size-3.5" />
  return (
    <Tip label={tab.error ?? (tab.path ? tab.path : 'This document has not been saved yet')}>
      <span data-testid="save-status" className={cx('no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-text-3', s === 'error' && 'text-danger')}>
        {icon}
        {label}
      </span>
    </Tip>
  )
}

function DocTab({ tab, active }: { tab: TabMeta; active: boolean }) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          docs.closeTab(tab.id)
        } else docs.activate(tab.id)
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && docs.activate(tab.id)}
      title={tab.path ?? tab.title}
      className={cx(
        'no-drag group relative flex h-[30px] min-w-0 max-w-[200px] shrink cursor-default items-center gap-2 rounded-lg pl-2.5 pr-1 text-[12.5px] transition-colors',
        active ? 'bg-panel font-medium text-text shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)]' : 'text-text-2 hover:bg-hover'
      )}
    >
      <FileText className={cx('size-3.5 shrink-0', active ? 'text-accent' : 'text-text-3')} />
      <span className="truncate">{tab.title}</span>
      <button
        aria-label={`Close ${tab.title}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => docs.closeTab(tab.id)}
        className="relative ml-auto flex size-5 shrink-0 items-center justify-center rounded text-text-3 hover:bg-active hover:text-text"
      >
        {tab.dirty ? (
          <>
            <span className="size-2 rounded-full bg-text-3 group-hover:hidden" data-testid="dirty-dot" />
            <X className="hidden size-3.5 group-hover:block" />
          </>
        ) : (
          <X className={cx('size-3.5', !active && 'opacity-0 group-hover:opacity-100')} />
        )}
      </button>
    </div>
  )
}

export function TitleBar() {
  const { tabs, active, dark } = useApp(useShallow((s) => ({ tabs: s.tabs, active: s.active, dark: s.dark })))
  const editor = useActiveEditor()
  const snap = useSnapshot(editor)
  const tab = tabs.find((t) => t.id === active)
  const platform = window.simpleDocs.platform
  const isMac = platform === 'darwin'
  const inset = useOverlayInset()
  const customControls = !isMac && inset === 0

  return (
    <header className="drag flex h-11 shrink-0 items-center gap-1 border-b border-border bg-bg pr-2" style={{ paddingLeft: isMac ? 80 : 10, paddingRight: inset ? inset + 8 : undefined }}>
      <Tip label="Home">
        <button onClick={() => set({ active: HOME, backstage: false })} className="no-drag mr-1 flex items-center gap-2 rounded-lg p-1 transition-opacity hover:opacity-85" aria-label="Home">
          <Logo />
        </button>
      </Tip>
      <nav role="tablist" aria-label="Open documents" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <button
          role="tab"
          aria-selected={active === HOME}
          onClick={() => set({ active: HOME, backstage: false })}
          className={cx('no-drag flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors', active === HOME ? 'bg-panel font-medium text-text shadow-[0_0_0_1px_var(--border)]' : 'text-text-2 hover:bg-hover')}
        >
          <Home className="size-3.5" />
          {tabs.length === 0 && 'Home'}
        </button>
        {tabs.map((t) => (
          <DocTab key={t.id} tab={t} active={t.id === active} />
        ))}
        <IconBtn label="New document" shortcut={shortcutFor('file.new')} className="no-drag" onClick={() => runCommand('file.new')}>
          <Plus className="size-4" />
        </IconBtn>
        <div className="h-full flex-1" />
      </nav>

      {tab && (
        <div className="no-drag flex items-center gap-0.5">
          {tab.warnings.length > 0 && (
            <Tip label="Compatibility notes for this file">
              <button onClick={() => set({ dialog: { kind: 'compat', tabId: tab.id } })} className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-warn hover:bg-hover" data-testid="compat-badge">
                <AlertTriangle className="size-3.5" />
                {tab.warnings.length}
              </button>
            </Tip>
          )}
          <SaveStatus tab={tab} />
          <div className="mx-1 h-4 w-px bg-border" />
          <IconBtn label="Save" shortcut={shortcutFor('file.save')} onClick={() => runCommand('file.save')}>
            <Save className="size-4" />
          </IconBtn>
          <IconBtn label="Undo" shortcut={shortcutFor('edit.undo')} disabled={!snap.canUndo} onClick={() => runCommand('edit.undo')}>
            <Undo2 className="size-4" />
          </IconBtn>
          <IconBtn label="Redo" shortcut={shortcutFor('edit.redo')} disabled={!snap.canRedo} onClick={() => runCommand('edit.redo')}>
            <Redo2 className="size-4" />
          </IconBtn>
          <IconBtn label="Find and replace" shortcut={shortcutFor('edit.find')} onClick={() => runCommand('edit.find')}>
            <Search className="size-4" />
          </IconBtn>
          <div className="mx-1 h-4 w-px bg-border" />
          {tab.kind !== 'pdf' && <Menu>
            <MenuTrigger asChild>
              <Btn variant="primary" size="sm" className="h-7 gap-1.5 px-2.5">
                <Download className="size-3.5" />
                Export
              </Btn>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem shortcut={shortcutFor('file.exportPdf')} onSelect={() => docs.exportPdf()}>
                PDF document
              </MenuItem>
              <MenuSep />
              <MenuItem onSelect={() => docs.save(undefined, { format: 'docx' })}>Word document (.docx)</MenuItem>
              <MenuItem onSelect={() => docs.save(undefined, { format: 'odt' })}>OpenDocument (.odt)</MenuItem>
              <MenuItem onSelect={() => docs.save(undefined, { format: 'rtf' })}>Rich Text (.rtf)</MenuItem>
              <MenuItem onSelect={() => docs.save(undefined, { format: 'md' })}>Markdown (.md)</MenuItem>
              <MenuItem onSelect={() => docs.save(undefined, { format: 'html' })}>Web page (.html)</MenuItem>
              <MenuItem onSelect={() => docs.save(undefined, { format: 'txt' })}>Plain text (.txt)</MenuItem>
              <MenuSep />
              <MenuItem shortcut={shortcutFor('file.print')} onSelect={() => docs.print()}>
                Print…
              </MenuItem>
            </MenuContent>
          </Menu>}
        </div>
      )}
      <div className="no-drag ml-1 flex items-center gap-0.5">
        <IconBtn label={dark ? 'Light mode' : 'Dark mode'} onClick={() => runCommand('view.theme')}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconBtn>
        <IconBtn label="Settings" shortcut={shortcutFor('tools.settings')} onClick={() => runCommand('tools.settings')}>
          <Settings className="size-4" />
        </IconBtn>
      </div>
      {customControls && (
        <div className="no-drag -mr-2 ml-2 flex h-full items-stretch">
          <button aria-label="Minimize" onClick={() => window.simpleDocs.windowMinimize()} className="flex w-11 items-center justify-center text-text-2 hover:bg-hover">
            <Minus className="size-4" />
          </button>
          <button aria-label="Maximize" onClick={() => window.simpleDocs.windowToggleMaximize()} className="flex w-11 items-center justify-center text-text-2 hover:bg-hover">
            <Square className="size-3.5" />
          </button>
          <button aria-label="Close window" onClick={() => window.simpleDocs.windowClose()} className="flex w-11 items-center justify-center text-text-2 hover:bg-[#e81123] hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}
    </header>
  )
}
