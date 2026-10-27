import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CheckCircle2, AlertCircle, Info, Minimize2, FileUp, Lock } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { HOME, useApp, set, get, editors, toast, type TabMeta } from '../state/store'
import * as docs from '../state/documents'
import { handleKeydown, runCommand, applyPainter } from './commands'
import { DocumentView } from './DocumentView'
import { TitleBar } from './TitleBar'
import { Ribbon } from './Ribbon'
import { LeftSidebar, RightSidebar, StatusBar } from './Panels'
import { Dashboard, Backstage } from './Dashboard'
import { Dialogs } from './Dialogs'
import { FindBar, FloatingToolbar, EditorContextMenu } from './Overlays'
import { SourceEditor } from './SourceEditor'
import { TooltipProvider, Btn, cx } from '../ui'
import { setTrackAuthor } from '@/editor/track'
import { PROTECTION_LABELS, setProtection, setProtectionNotice, type ProtectionMode } from '@/editor/protection'
import { PdfWorkspace } from '../pdf/PdfWorkspace'

setTrackAuthor(() => get().settings.authorName || 'Author')
let lastNotice = 0
setProtectionNotice((mode) => {
  if (Date.now() - lastNotice < 4000) return
  lastNotice = Date.now()
  toast(mode === 'tracked' ? 'This document only allows tracked changes: tracking stays on and changes cannot be accepted or rejected.' : `This document is protected (${PROTECTION_LABELS[mode].toLowerCase()}). Review → Protect → Stop protection to edit.`, 'info')
})

function ProtectionBar({ editor }: { editor: Editor }) {
  const mode = useEditorState({ editor, selector: ({ editor: e }) => (e.state.doc.attrs.protection as ProtectionMode | null) ?? null })
  if (!mode) return null
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-8 items-center justify-center gap-2 border-b border-border bg-panel/95 text-[12px] text-text-2 backdrop-blur" data-testid="protection-bar">
      <Lock className="size-3.5" />
      Protected: {PROTECTION_LABELS[mode]}
      <button className="ml-1 rounded px-1.5 font-medium text-accent hover:bg-accent-soft" onClick={() => setProtection(editor, null)}>
        Stop protection
      </button>
    </div>
  )
}

async function boot() {
  const api = window.simpleDocs
  const [settings, recents, recovery, libreOffice] = await Promise.all([api.settingsGet(), api.recentList(), api.recoveryList(), api.libreOfficeAvailable()])
  set({ settings, recents, recovery, libreOffice, ready: true })
}

function useTheme() {
  const { theme, accent, reduceMotion } = useApp(useShallow((s) => ({ theme: s.settings.theme, accent: s.settings.accent, reduceMotion: s.settings.reduceMotion })))
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.setProperty('--accent', accent)
      set({ dark })
      window.simpleDocs.setTitleBarColors({ color: dark ? '#121214' : '#f7f7f8', symbolColor: dark ? '#d4d4d8' : '#3f3f46' })
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, accent])
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [reduceMotion])
}

function TabView({ tab, hidden }: { tab: TabMeta; hidden: boolean }) {
  if (tab.kind === 'pdf')
    return (
      <div hidden={hidden} className="absolute inset-0">
        <PdfWorkspace tabId={tab.id} />
      </div>
    )
  return <DocTabView tab={tab} hidden={hidden} />
}

function DocTabView({ tab, hidden }: { tab: TabMeta; hidden: boolean }) {
  const editor = editors.get(tab.id)
  const { zoom, showMarks, showBoundaries, showRuler, painter, showMarkup } = useApp(useShallow((s) => ({ zoom: s.zoom, showMarks: s.showMarks, showBoundaries: s.showBoundaries, showRuler: s.settings.showRuler && !s.focusMode, painter: !!s.painter, showMarkup: s.showMarkup })))
  if (!editor) return null
  return (
    <div hidden={hidden} className={cx('absolute inset-0', painter && '[&_.sd-doc]:cursor-copy', !showMarkup && 'final-view')} onMouseUp={() => painter && applyPainter(editor)}>
      {tab.mode === 'source' ? (
        <SourceEditor editor={editor} />
      ) : (
        <>
          <EditorContextMenu editor={editor}>
            <div className="h-full">
              <DocumentView tabId={tab.id} editor={editor} zoom={zoom} showMarks={showMarks} showBoundaries={showBoundaries} showRuler={showRuler} onZoomChange={(z) => set({ zoom: z })} />
            </div>
          </EditorContextMenu>
          <ProtectionBar editor={editor} />
          {!hidden && <FindBar editor={editor} />}
          {!hidden && <FloatingToolbar editor={editor} />}
        </>
      )}
    </div>
  )
}

function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-[120] flex flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="slide-up pointer-events-auto flex max-w-[560px] items-center gap-2.5 rounded-xl bg-[#1c1c22] px-4 py-2.5 text-[13px] text-white shadow-[0_12px_32px_-8px_rgb(0_0_0/0.45)] dark:bg-[#2a2a30]">
          {t.kind === 'success' ? <CheckCircle2 className="size-4 text-emerald-400" /> : t.kind === 'error' ? <AlertCircle className="size-4 text-red-400" /> : <Info className="size-4 text-sky-300" />}
          {t.message}
        </div>
      ))}
    </div>
  )
}

function DropOverlay() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || (e.target as HTMLElement).closest?.('.sd-doc')) return
      depth++
      setOver(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overH = (e: DragEvent) => {
      if (hasFiles(e) && !(e.target as HTMLElement).closest?.('.sd-doc')) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      depth = 0
      setOver(false)
      if ((e.target as HTMLElement).closest?.('.sd-doc')) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) void docs.openDroppedFiles(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('drop', drop)
    }
  }, [])
  if (!over) return null
  return (
    <div className="fade-in pointer-events-none fixed inset-3 z-[110] flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm">
      <div className="flex flex-col items-center gap-2 text-accent">
        <FileUp className="size-8" />
        <div className="text-[15px] font-semibold">Drop to open</div>
      </div>
    </div>
  )
}

export function App() {
  const { ready, active, tabs, focusMode } = useApp(useShallow((s) => ({ ready: s.ready, active: s.active, tabs: s.tabs, focusMode: s.focusMode })))
  const isPdf = tabs.find((t) => t.id === active)?.kind === 'pdf'
  useTheme()
  useEffect(() => {
    void boot()
    const api = window.simpleDocs
    window.addEventListener('keydown', handleKeydown, true)
    const offs = [api.onOpenFiles((f) => void docs.openFiles(f)), api.onCloseRequest(() => docs.requestQuit()), api.onMenuCommand((id) => runCommand(id))]
    const openNote = (e: Event) => set({ note: { tabId: get().active, pos: (e as CustomEvent<number>).detail } })
    window.addEventListener('sd:open-note', openNote)
    offs.push(() => window.removeEventListener('sd:open-note', openNote))
    const openComment = () => get().rightPanel !== 'comments' && set({ rightPanel: 'comments' })
    const newC = () => runCommand('review.comment')
    window.addEventListener('sd:open-comment', openComment)
    const editEq = (e: Event) => set({ dialog: { kind: 'equation', pos: (e as CustomEvent<number>).detail } })
    window.addEventListener('sd:edit-equation', editEq)
    const editDrawing = (e: Event) => set({ dialog: { kind: 'drawing', mode: 'chart', pos: (e as CustomEvent<number>).detail } })
    window.addEventListener('sd:edit-drawing', editDrawing)
    offs.push(() => window.removeEventListener('sd:edit-drawing', editDrawing))
    offs.push(() => window.removeEventListener('sd:edit-equation', editEq))
    document.addEventListener('sd:new-comment', newC)
    offs.push(() => window.removeEventListener('sd:open-comment', openComment), () => document.removeEventListener('sd:new-comment', newC))
    // Test/automation hook (renderer-only; exposes nothing the page could not already reach).
    ;(window as unknown as Record<string, unknown>).__sd = { get, set, editors, docs, runCommand }
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
      offs.forEach((o) => o())
    }
  }, [])

  if (!ready) return <div className="h-full bg-bg" />
  const home = active === HOME
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {!focusMode && <TitleBar />}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!home && !isPdf && !focusMode && <Ribbon />}
          <div className="flex min-h-0 flex-1">
            {!home && !isPdf && !focusMode && <LeftSidebar />}
            <main className="relative min-w-0 flex-1" aria-label="Document">
              {tabs.map((t) => (
                <TabView key={t.id} tab={t} hidden={home || t.id !== active} />
              ))}
              {home && (
                <div className="absolute inset-0">
                  <Dashboard />
                </div>
              )}
            </main>
            {!home && !isPdf && !focusMode && <RightSidebar />}
          </div>
          {!home && !isPdf && !focusMode && <StatusBar />}
          {!home && !isPdf && <Backstage />}
        </div>
        {focusMode && (
          <Btn variant="secondary" size="sm" className="fixed right-4 top-4 z-50 opacity-40 hover:opacity-100" onClick={() => runCommand('view.focus')}>
            <Minimize2 className="size-3.5" /> Exit focus
          </Btn>
        )}
        <Dialogs />
        <Toasts />
        <DropOverlay />
      </div>
    </TooltipProvider>
  )
}
