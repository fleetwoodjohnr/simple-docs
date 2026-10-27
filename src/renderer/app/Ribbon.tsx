import { useEffect, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { Sparkles, Shapes, BarChart3, Users, Braces, ChevronLeft, ChevronRight, BookMarked, Library, BookImage, Lock, GitCompare, Accessibility,
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, CalendarDays, CaseSensitive, ChevronDown, ChevronUp, ClipboardPaste, Code2, Columns3, Copy, Eraser, Eye, FileDown, Focus,
  Highlighter, Image as ImageIcon, IndentDecrease, IndentIncrease, Info, Italic, Keyboard, Link2, List, ListChecks, ListOrdered, Maximize2, Minus, Moon, PaintBucket, Paintbrush, PanelLeft,
  PanelRight, Pilcrow, Plus, Printer, Quote, Redo2, Replace, Ruler, Scissors, Search, Settings, Sigma, SquareDashed, Strikethrough, Subscript, Superscript, Table2, Type, Underline, Undo2,
  Volume2, WrapText, ZoomIn, ZoomOut, BookOpen, PanelTop, PanelBottom, Hash, ListTree, RefreshCw, MessageSquarePlus, MessagesSquare, CheckCheck, XCircle, ArrowUpToLine, ArrowDownToLine, FilePenLine, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, ArrowDownAZ, ArrowUpZA, FileCode2, ShieldCheck, Merge, Split, Trash2, Rows3, AlignStartVertical, AlignEndVertical, RectangleHorizontal, RectangleVertical
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { bodyEditor, useApp, set, updateSettings, type RibbonTab } from '../state/store'
import { insertCoverPage, applyStyle, changeCase, FONT_SIZES, insertPageNumber, runCommand, shortcutFor, SYMBOLS, updateBlocks, zoomTo } from './commands'
import { useActiveEditor, useBodyEditor, useSnapshot, type Snapshot } from './hooks'
import { useEditorState } from '@tiptap/react'
import { ColorGrid, IconBtn, Menu, MenuCheck, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger, NumberInput, Pop, PopClose, PopContent, PopTrigger, SubMenu, Tip, cx } from '../ui'
import { MARGIN_PRESETS, PAGE_SIZES, withOrientation, withSize, type PageSetup, type StyleMap, resolveStyle } from '@/editor/model'
import { pageOf } from '@/layout/plugin'
import { fontStack } from '@/editor/styles-css'
import { PROTECTION_LABELS, setProtection, type ProtectionMode } from '@/editor/protection'
import { COVER_PAGES } from '@/editor/templates'
import { CITATION_STYLES, insertBibliography, setCitationStyle, styleOf } from '@/editor/citations'
import { openSources } from './Citations'
import { insertMergeField } from '@/editor/mailmerge'
import { finishMerge, previewRecord, selectRecipients } from '../state/mailmerge'
import { setTableStyle, TABLE_STYLES, type TableStyle } from '@/editor/tables'

const TABS: { id: RibbonTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'layout', label: 'Layout' },
  { id: 'references', label: 'References' },
  { id: 'review', label: 'Review' },
  { id: 'view', label: 'View' },
  { id: 'tools', label: 'Tools' }
]

const Sep = () => <div className="mx-1.5 h-6 w-px shrink-0 bg-border" />

function Group({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5">
      {children}
    </div>
  )
}

/** Icon button wired to a registry command. */
function Cmd({ id, icon, active, label, disabled }: { id: string; icon: ReactNode; active?: boolean; label?: string; disabled?: boolean }) {
  return (
    <IconBtn label={label ?? id} shortcut={shortcutFor(id)} active={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand(id)}>
      {icon}
    </IconBtn>
  )
}

function TextBtn({ icon, children, onClick, active, label, shortcut }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; active?: boolean; label?: string; shortcut?: string }) {
  const b = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      className={cx('flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-2 transition-colors hover:bg-hover hover:text-text [&>svg]:size-4', active && 'bg-accent-soft text-accent')}
    >
      {icon}
      {children}
    </button>
  )
  return label ? (
    <Tip label={label} shortcut={shortcut}>
      {b}
    </Tip>
  ) : (
    b
  )
}

function DropBtn({ icon, children, label, active }: { icon?: ReactNode; children?: ReactNode; label: string; active?: boolean }) {
  return (
    <MenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        className={cx('flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12.5px] text-text-2 transition-colors hover:bg-hover hover:text-text data-[state=open]:bg-hover [&>svg:first-child]:size-4', active && 'bg-accent-soft text-accent')}
      >
        {icon}
        {children}
        <ChevronDown className="size-3 opacity-60" />
      </button>
    </MenuTrigger>
  )
}

// ---------- fonts ----------

const BASE_FONTS = ['Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Courier New', 'Carlito', 'Caladea', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Georgia', 'Verdana', 'Helvetica']
let systemFonts: string[] | null = null

function useFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>(systemFonts ?? BASE_FONTS)
  useEffect(() => {
    if (systemFonts) return
    const q = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!q) return
    q()
      .then((list) => {
        systemFonts = [...new Set([...BASE_FONTS, ...list.map((f) => f.family)])].sort((a, b) => a.localeCompare(b))
        setFonts(systemFonts)
      })
      .catch(() => {})
  }, [])
  return fonts
}

function FontPicker({ editor, value }: { editor: Editor; value: string }) {
  const fonts = useFonts()
  const [q, setQ] = useState('')
  const list = fonts.filter((f) => f.toLowerCase().includes(q.toLowerCase())).slice(0, 300)
  return (
    <Pop>
      <Tip label="Font">
        <PopTrigger asChild>
          <button onMouseDown={(e) => e.preventDefault()} aria-label="Font" data-testid="font-picker" className="flex h-7 w-[150px] shrink-0 items-center justify-between rounded-md border border-border bg-panel px-2 text-left text-[12.5px] hover:border-border-strong">
            <span className="truncate" style={{ fontFamily: fontStack(value) }}>
              {value}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopTrigger>
      </Tip>
      <PopContent align="start" className="w-[260px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fonts" aria-label="Search fonts" className="mb-1 h-8 w-full rounded-md border border-border bg-panel px-2 text-[12.5px] outline-none focus:border-accent" />
        <div className="max-h-[320px] overflow-y-auto">
          {list.map((f) => (
            <button
              key={f}
              onClick={() => editor.chain().focus().setFontFamily(f).run()}
              className={cx('flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover', f === value && 'bg-accent-soft text-accent')}
              style={{ fontFamily: fontStack(f) }}
            >
              {f}
            </button>
          ))}
        </div>
      </PopContent>
    </Pop>
  )
}

function SizePicker({ editor, value }: { editor: Editor; value: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  const apply = (v: string) => {
    const n = parseFloat(v)
    if (n >= 1 && n <= 1638) editor.chain().focus().setFontSize(`${n}pt`).run()
    setDraft(null)
  }
  return (
    <Menu>
      <div className="flex h-7 w-[58px] shrink-0 items-center rounded-md border border-border bg-panel hover:border-border-strong">
        <input
          aria-label="Font size"
          data-testid="font-size"
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft != null && apply(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setDraft(null)
          }}
          className="w-full min-w-0 bg-transparent pl-2 text-[12.5px] tabular-nums outline-none"
        />
        <MenuTrigger asChild>
          <button aria-label="Font sizes" onMouseDown={(e) => e.preventDefault()} className="flex h-full items-center px-1 text-text-3 hover:text-text">
            <ChevronDown className="size-3" />
          </button>
        </MenuTrigger>
      </div>
      <MenuContent className="max-h-[320px] min-w-[80px] overflow-y-auto">
        {FONT_SIZES.map((s) => (
          <MenuItem key={s} onSelect={() => editor.chain().focus().setFontSize(`${s}pt`).run()} className={s === value ? 'text-accent' : ''}>
            {s}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

function ColorBtn({ label, icon, color, onPick, onClear, clearLabel }: { label: string; icon: ReactNode; color: string | null; onPick: (c: string) => void; onClear: () => void; clearLabel: string }) {
  return (
    <Pop>
      <Tip label={label}>
        <PopTrigger asChild>
          <button onMouseDown={(e) => e.preventDefault()} aria-label={label} className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1 text-text-2 hover:bg-hover hover:text-text data-[state=open]:bg-hover">
            <span className="relative flex flex-col items-center [&>svg]:size-4">
              {icon}
              <span className="mt-[1px] h-[3px] w-4 rounded-full" style={{ background: color ?? 'transparent', boxShadow: color ? undefined : 'inset 0 0 0 1px var(--border-strong)' }} />
            </span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </PopTrigger>
      </Tip>
      <PopContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <ColorGrid value={color} onPick={onPick} onClear={onClear} clearLabel={clearLabel} />
      </PopContent>
    </Pop>
  )
}

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3]

// ---------- style gallery ----------

const GALLERY = ['Normal', 'Title', 'Heading1', 'Heading2', 'Heading3', 'Subtitle', 'Quote']

function StyleGallery({ editor, current }: { editor: Editor; current: string }) {
  const styles = (editor.state.doc.attrs.styles ?? {}) as StyleMap
  const preview = (id: string) => {
    const { run } = resolveStyle(styles, id)
    return {
      fontFamily: run.fontFamily ? fontStack(run.fontFamily) : undefined,
      fontWeight: run.bold ? 700 : 400,
      fontStyle: run.italic ? 'italic' : 'normal',
      color: run.color && run.color !== '#000000' ? run.color : undefined,
      fontSize: Math.min(15, Math.max(11, (run.fontSize ?? 11) * 0.62 + 5))
    }
  }
  const all = Object.values(styles).filter((s) => s.type === 'paragraph' && !s.hidden)
  return (
    <div className="flex items-center gap-1">
      <div className="flex h-[34px] items-stretch gap-1 overflow-hidden rounded-lg border border-border bg-panel-2 p-[3px]">
        {GALLERY.filter((id) => styles[id]).map((id, i) => (
          <button
            key={id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyStyle(editor, id)}
            data-testid={`style-${id}`}
            className={cx(
              'flex w-[68px] flex-col justify-center rounded-md px-2 text-left transition-colors hover:bg-hover',
              current === id && 'bg-panel shadow-[0_0_0_1px_var(--accent)]',
              i >= 5 && 'max-[1700px]:hidden',
              i >= 3 && 'max-[1440px]:hidden'
            )}
          >
            <span className="truncate leading-tight text-text" style={preview(id)}>
              {styles[id].name.replace('Heading', 'Heading')}
            </span>
          </button>
        ))}
      </div>
      <Menu>
        <DropBtn label="All styles" />
        <MenuContent className="max-h-[460px] min-w-[240px] overflow-y-auto">
          <MenuItem onSelect={() => runCommand('style.modify')}>Modify “{styles[current]?.name ?? current}”…</MenuItem>
          <MenuItem onSelect={() => runCommand('style.updateFromSelection')}>Update “{styles[current]?.name ?? current}” to match selection</MenuItem>
          <MenuItem onSelect={() => runCommand('style.new')}>New style…</MenuItem>
          <MenuSep />
          <MenuLabel>Paragraph styles</MenuLabel>
          {all.map((s) => (
            <MenuItem key={s.id} onSelect={() => applyStyle(editor, s.id)} className={current === s.id ? 'text-accent' : ''}>
              <span style={{ ...preview(s.id), fontSize: 13 }}>{s.name}</span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}

// ---------- tabs ----------

function HomeTab({ editor, s }: { editor: Editor; s: Snapshot }) {
  const painter = useApp((st) => !!st.painter)
  return (
    <>
      <Group label="Clipboard">
        <Cmd id="edit.paste" label="Paste" icon={<ClipboardPaste className="size-4" />} />
        <span className="contents max-[1560px]:hidden">
          <Cmd id="edit.cut" label="Cut" icon={<Scissors className="size-4" />} />
          <Cmd id="edit.copy" label="Copy" icon={<Copy className="size-4" />} />
        </span>
        <Cmd id="fmt.painter" label="Format painter" active={painter} icon={<Paintbrush className="size-4" />} />
      </Group>
      <Sep />
      <Group label="Font">
        <FontPicker editor={editor} value={s.font} />
        <SizePicker editor={editor} value={s.size} />
        <Cmd id="fmt.grow" label="Increase font size" icon={<span className="text-[13px] font-semibold">A<sup className="text-[8px]">+</sup></span>} />
        <Cmd id="fmt.shrink" label="Decrease font size" icon={<span className="text-[11px] font-semibold">A<sup className="text-[8px]">−</sup></span>} />
      </Group>
      <Sep />
      <Group label="Character">
        <Cmd id="fmt.bold" label="Bold" active={s.bold} icon={<Bold className="size-4" />} />
        <Cmd id="fmt.italic" label="Italic" active={s.italic} icon={<Italic className="size-4" />} />
        <Cmd id="fmt.underline" label="Underline" active={s.underline} icon={<Underline className="size-4" />} />
        <Cmd id="fmt.strike" label="Strikethrough" active={s.strike} icon={<Strikethrough className="size-4" />} />
        <Cmd id="fmt.subscript" label="Subscript" active={s.sub} icon={<Subscript className="size-4" />} />
        <Cmd id="fmt.superscript" label="Superscript" active={s.sup} icon={<Superscript className="size-4" />} />
        <ColorBtn
          label="Text color"
          icon={<Baseline />}
          color={s.color}
          onPick={(c) => editor.chain().focus().setColor(c).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
          clearLabel="Automatic"
        />
        <ColorBtn
          label="Highlight"
          icon={<Highlighter />}
          color={s.highlight}
          onPick={(c) => editor.chain().focus().setHighlight({ color: c }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
          clearLabel="No highlight"
        />
        <Menu>
          <Tip label="More text effects">
            <DropBtn label="Text effects" icon={<CaseSensitive />} />
          </Tip>
          <MenuContent>
            <MenuLabel>Change case</MenuLabel>
            <MenuItem onSelect={() => changeCase(editor, 'sentence')}>Sentence case.</MenuItem>
            <MenuItem onSelect={() => changeCase(editor, 'lower')}>lowercase</MenuItem>
            <MenuItem onSelect={() => changeCase(editor, 'upper')}>UPPERCASE</MenuItem>
            <MenuItem onSelect={() => changeCase(editor, 'title')}>Capitalize Each Word</MenuItem>
            <MenuItem shortcut={shortcutFor('case.toggle')} onSelect={() => changeCase(editor, 'toggle')}>
              tOGGLE cASE
            </MenuItem>
            <MenuSep />
            <MenuCheck checked={s.doubleStrike} onSelect={() => runCommand('fmt.doubleStrike')}>
              Double strikethrough
            </MenuCheck>
            <MenuCheck checked={!!editor.getAttributes('textStyle').smallCaps} onSelect={() => runCommand('fmt.smallCaps')}>
              Small caps
            </MenuCheck>
            <MenuCheck checked={!!editor.getAttributes('textStyle').caps} onSelect={() => runCommand('fmt.caps')}>
              All caps
            </MenuCheck>
            <MenuCheck checked={s.code} onSelect={() => runCommand('fmt.code')}>
              Inline code
            </MenuCheck>
            <SubMenu label="Character spacing">
              {[
                ['Condensed', -0.5],
                ['Normal', null],
                ['Expanded', 1],
                ['Very expanded', 2]
              ].map(([l, v]) => (
                <MenuItem key={String(l)} onSelect={() => editor.chain().focus().setMark('textStyle', { letterSpacing: v }).run()}>
                  {l}
                </MenuItem>
              ))}
            </SubMenu>
          </MenuContent>
        </Menu>
        <Cmd id="fmt.clear" label="Clear formatting" icon={<Eraser className="size-4" />} />
      </Group>
      <Sep />
      <Group label="Paragraph">
        <ListMenu editor={editor} s={s} />
        <Cmd id="para.outdent" label="Decrease indent" icon={<IndentDecrease className="size-4" />} />
        <Cmd id="para.indent" label="Increase indent" icon={<IndentIncrease className="size-4" />} />
        <Cmd id="para.left" label="Align left" active={s.align === 'left'} icon={<AlignLeft className="size-4" />} />
        <Cmd id="para.center" label="Center" active={s.align === 'center'} icon={<AlignCenter className="size-4" />} />
        <Cmd id="para.right" label="Align right" active={s.align === 'right'} icon={<AlignRight className="size-4" />} />
        <Cmd id="para.justify" label="Justify" active={s.align === 'justify'} icon={<AlignJustify className="size-4" />} />
        <Menu>
          <Tip label="Line and paragraph spacing">
            <DropBtn label="Line spacing" icon={<WrapText />} />
          </Tip>
          <MenuContent>
            <MenuLabel>Line spacing</MenuLabel>
            {LINE_SPACINGS.map((v) => (
              <MenuCheck key={v} checked={s.lineHeight === v} onSelect={() => updateBlocks(editor, { lineHeight: v })}>
                {v.toFixed(v === 1.15 ? 2 : 1)}
              </MenuCheck>
            ))}
            <MenuSep />
            <MenuItem onSelect={() => updateBlocks(editor, { spaceBefore: s.spaceBefore ? null : 12 })}>{s.spaceBefore ? 'Remove space before paragraph' : 'Add space before paragraph'}</MenuItem>
            <MenuItem onSelect={() => updateBlocks(editor, { spaceAfter: s.spaceAfter === 0 ? null : 0 })}>{s.spaceAfter === 0 ? 'Add space after paragraph' : 'Remove space after paragraph'}</MenuItem>
          </MenuContent>
        </Menu>
        <ColorBtn
          label="Paragraph shading"
          icon={<PaintBucket />}
          color={(editor.state.selection.$from.parent.attrs.shading as string) ?? null}
          onPick={(c) => updateBlocks(editor, { shading: c })}
          onClear={() => updateBlocks(editor, { shading: null })}
          clearLabel="No shading"
        />
        <Cmd id="view.marks" label="Show formatting marks" active={useApp((st) => st.showMarks)} icon={<Pilcrow className="size-4" />} />
      </Group>
      <Sep />
      <StyleGallery editor={editor} current={s.styleId} />
      <span className="contents max-[1620px]:hidden">
        <Sep />
        <Group label="Editing">
          <Cmd id="edit.find" label="Find" icon={<Search className="size-4" />} />
          <Cmd id="edit.replace" label="Replace" icon={<Replace className="size-4" />} />
        </Group>
      </span>
    </>
  )
}

function ListMenu({ editor, s }: { editor: Editor; s: Snapshot }) {
  const setBullet = (bullet: string | null) => {
    if (!editor.isActive('bulletList')) editor.chain().focus().toggleBulletList().run()
    editor.chain().focus().updateAttributes('bulletList', { bullet }).run()
  }
  const setNumbering = (type: string | null) => {
    if (!editor.isActive('orderedList')) editor.chain().focus().toggleOrderedList().run()
    editor.chain().focus().updateAttributes('orderedList', { type }).run()
  }
  return (
    <>
      <div className="flex items-center">
        <Cmd id="list.bullet" label="Bulleted list" active={s.bullet} icon={<List className="size-4" />} />
        <Menu>
          <DropBtn label="Bullet styles" />
          <MenuContent>
            <MenuLabel>Bullet style</MenuLabel>
            <div className="grid grid-cols-4 gap-1 p-1">
              {['•', '◦', '▪', '–', '➢', '✓', '★', '◆'].map((b) => (
                <button key={b} onClick={() => setBullet(b === '•' ? null : b)} className="flex size-10 items-center justify-center rounded-md border border-border text-[18px] hover:bg-hover">
                  {b}
                </button>
              ))}
            </div>
          </MenuContent>
        </Menu>
      </div>
      <div className="flex items-center">
        <Cmd id="list.ordered" label="Numbered list" active={s.ordered} icon={<ListOrdered className="size-4" />} />
        <Menu>
          <DropBtn label="Numbering styles" />
          <MenuContent>
            <MenuLabel>Numbering</MenuLabel>
            {[
              ['1.', '1'],
              ['a.', 'a'],
              ['A.', 'A'],
              ['i.', 'i'],
              ['I.', 'I'],
              ['1.1.', '1.1'],
              ['Automatic by level', null]
            ].map(([l, v]) => (
              <MenuItem key={String(l)} onSelect={() => setNumbering(v)}>
                {l}
              </MenuItem>
            ))}
            <MenuSep />
            <MenuItem onSelect={() => editor.chain().focus().updateAttributes('orderedList', { start: 1 }).run()}>Restart at 1</MenuItem>
            <MenuItem
              onSelect={() => {
                const v = window.prompt('Start numbering at', String(editor.getAttributes('orderedList').start ?? 1))
                if (v && Number(v) > 0) editor.chain().focus().updateAttributes('orderedList', { start: Number(v) }).run()
              }}
            >
              Set numbering value…
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <Cmd id="list.task" label="Checklist" active={s.task} icon={<ListChecks className="size-4" />} />
    </>
  )
}

function TablePicker({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState<[number, number]>([0, 0])
  return (
    <Pop>
      <Tip label="Table">
        <PopTrigger asChild>
          <button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-hover hover:text-text data-[state=open]:bg-hover">
            <Table2 className="size-4" />
            Table
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </PopTrigger>
      </Tip>
      <PopContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="mb-2 text-[12px] font-medium text-text-2">{hover[0] ? `${hover[1]} × ${hover[0]} table` : 'Insert table'}</div>
        <button onClick={() => runCommand('table.fromText')} className="mb-2 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12px] text-text-2 hover:bg-hover">
          <Table2 className="size-3.5" /> Convert selected text to table
        </button>
        <div className="grid grid-cols-10 gap-[3px]" onMouseLeave={() => setHover([0, 0])}>
          {Array.from({ length: 80 }, (_, i) => {
            const r = Math.floor(i / 10) + 1
            const c = (i % 10) + 1
            const on = r <= hover[0] && c <= hover[1]
            return (
              <PopClose
                key={i}
                aria-label={`${c} by ${r}`}
                onMouseEnter={() => setHover([r, c])}
                onClick={() => editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: true }).run()}
                className={cx('size-[17px] rounded-[3px] border transition-colors', on ? 'border-accent bg-accent-soft' : 'border-border bg-panel')}
              />
            )
          })}
        </div>
      </PopContent>
    </Pop>
  )
}

function SymbolPicker({ editor }: { editor: Editor }) {
  return (
    <Pop>
      <Tip label="Symbol">
        <PopTrigger asChild>
          <button onMouseDown={(e) => e.preventDefault()} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-hover hover:text-text data-[state=open]:bg-hover">
            <Sigma className="size-4" />
            Symbol
          </button>
        </PopTrigger>
      </Tip>
      <PopContent onOpenAutoFocus={(e) => e.preventDefault()} className="w-[312px]">
        <div className="grid grid-cols-10 gap-1">
          {SYMBOLS.map((c) => (
            <button key={c} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().insertContent(c).run()} className="flex size-[26px] items-center justify-center rounded-md text-[15px] hover:bg-hover">
              {c}
            </button>
          ))}
        </div>
      </PopContent>
    </Pop>
  )
}

function InsertTab({ editor }: { editor: Editor }) {
  return (
    <>
      <Group label="Pages">
        <Menu>
          <DropBtn label="Cover page" icon={<BookImage />}>
            Cover page
          </DropBtn>
          <MenuContent>
            {COVER_PAGES.map((c) => (
              <MenuItem key={c.id} onSelect={() => insertCoverPage(c.id)}>
                {c.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <TextBtn icon={<FileDown />} label="Page break" shortcut={shortcutFor('insert.pageBreak')} onClick={() => runCommand('insert.pageBreak')}>
          Page break
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Header & footer">
        <TextBtn icon={<PanelTop />} label="Edit the page header (or double-click the top margin)" onClick={() => runCommand('insert.header')}>
          Header
        </TextBtn>
        <TextBtn icon={<PanelBottom />} label="Edit the page footer (or double-click the bottom margin)" onClick={() => runCommand('insert.footer')}>
          Footer
        </TextBtn>
        <Menu>
          <DropBtn label="Page number" icon={<Hash />}>
            Page number
          </DropBtn>
          <MenuContent>
            <MenuLabel>Bottom of page</MenuLabel>
            <MenuItem onSelect={() => insertPageNumber('footer', 'center', false)}>Centered</MenuItem>
            <MenuItem onSelect={() => insertPageNumber('footer', 'right', false)}>Right</MenuItem>
            <MenuItem onSelect={() => insertPageNumber('footer', 'center', true)}>“Page X of Y”, centered</MenuItem>
            <MenuLabel>Top of page</MenuLabel>
            <MenuItem onSelect={() => insertPageNumber('header', 'right', false)}>Right</MenuItem>
            <MenuItem onSelect={() => insertPageNumber('header', 'center', false)}>Centered</MenuItem>
          </MenuContent>
        </Menu>
      </Group>
      <Sep />
      <Group label="Tables">
        <TablePicker editor={editor} />
      </Group>
      <Sep />
      <Group label="Illustrations">
        <TextBtn icon={<ImageIcon />} label="Insert image from file (or paste / drag an image)" onClick={() => runCommand('insert.image')}>
          Image
        </TextBtn>
        <TextBtn icon={<Shapes />} label="Insert a shape (double-click it later to edit)" onClick={() => set({ dialog: { kind: 'drawing', mode: 'shape' } })}>
          Shape
        </TextBtn>
        <TextBtn icon={<BarChart3 />} label="Insert a chart from a small table of data (double-click it later to edit)" onClick={() => set({ dialog: { kind: 'drawing', mode: 'chart' } })}>
          Chart
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Links">
        <TextBtn icon={<Link2 />} label="Link" shortcut={shortcutFor('insert.link')} onClick={() => runCommand('insert.link')}>
          Link
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Blocks">
        <TextBtn icon={<Minus />} onClick={() => runCommand('insert.hr')}>
          Divider
        </TextBtn>
        <TextBtn icon={<Quote />} onClick={() => runCommand('insert.quote')}>
          Quote
        </TextBtn>
        <TextBtn icon={<Code2 />} onClick={() => runCommand('insert.codeBlock')}>
          Code block
        </TextBtn>
        <TextBtn icon={<ListChecks />} onClick={() => runCommand('list.task')}>
          Checklist
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Text">
        <TextBtn icon={<Sigma />} label="Insert an equation (double-click one to edit it)" shortcut={shortcutFor('insert.equation')} onClick={() => runCommand('insert.equation')}>
          Equation
        </TextBtn>
        <SymbolPicker editor={editor} />
        <TextBtn icon={<CalendarDays />} onClick={() => runCommand('insert.date')}>
          Date
        </TextBtn>
      </Group>
    </>
  )
}

function LayoutTab({ editor, s }: { editor: Editor; s: Snapshot }) {
  const page = pageOf(editor.state.doc)
  const setPage = (p: PageSetup) => editor.chain().focus().command(({ tr }) => (tr.setDocAttribute('page', p), true)).run()
  const m = page.margins
  return (
    <>
      <Group label="Page setup">
        <Menu>
          <DropBtn label="Margins" icon={<SquareDashed />}>
            Margins
          </DropBtn>
          <MenuContent>
            {Object.entries(MARGIN_PRESETS).map(([k, v]) => (
              <MenuItem key={k} onSelect={() => setPage({ ...page, margins: { ...page.margins, ...v.margins } })}>
                <span className="w-20 font-medium">{v.label}</span>
                <span className="text-[11.5px] text-text-3">
                  {(v.margins.top / 72).toFixed(2)}″ top · {(v.margins.left / 72).toFixed(2)}″ sides
                </span>
              </MenuItem>
            ))}
            <MenuSep />
            <MenuItem onSelect={() => set({ rightPanel: 'page' })}>Custom margins…</MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <DropBtn label="Orientation" icon={page.orientation === 'portrait' ? <RectangleVertical /> : <RectangleHorizontal />}>
            Orientation
          </DropBtn>
          <MenuContent>
            <MenuCheck checked={page.orientation === 'portrait'} onSelect={() => setPage(withOrientation(page, 'portrait'))}>
              Portrait
            </MenuCheck>
            <MenuCheck checked={page.orientation === 'landscape'} onSelect={() => setPage(withOrientation(page, 'landscape'))}>
              Landscape
            </MenuCheck>
          </MenuContent>
        </Menu>
        <Menu>
          <DropBtn label="Size" icon={<Columns3 />}>
            Size
          </DropBtn>
          <MenuContent>
            {Object.entries(PAGE_SIZES).map(([k, v]) => (
              <MenuCheck key={k} checked={page.size === k} onSelect={() => setPage(withSize(page, k as keyof typeof PAGE_SIZES))}>
                <span className="w-16 font-medium">{v.label}</span>
                <span className="text-[11.5px] text-text-3">
                  {(v.width / 72).toFixed(2)}″ × {(v.height / 72).toFixed(2)}″
                </span>
              </MenuCheck>
            ))}
            <MenuSep />
            <MenuItem onSelect={() => set({ rightPanel: 'page' })}>Custom size…</MenuItem>
          </MenuContent>
        </Menu>
        <ColorBtn label="Page color" icon={<PaintBucket />} color={page.background} onPick={(c) => setPage({ ...page, background: c })} onClear={() => setPage({ ...page, background: null })} clearLabel="No color" />
        <TextBtn icon={<FileDown />} label="Insert page break" shortcut={shortcutFor('insert.pageBreak')} onClick={() => runCommand('insert.pageBreak')}>
          Break
        </TextBtn>
        <Menu>
          <DropBtn label="Page numbering" icon={<Hash />}>
            Numbering
          </DropBtn>
          <MenuContent>
            <MenuLabel>Format</MenuLabel>
            {(
              [
                ['1', '1, 2, 3'],
                ['i', 'i, ii, iii'],
                ['I', 'I, II, III'],
                ['a', 'a, b, c'],
                ['A', 'A, B, C']
              ] as const
            ).map(([f, l]) => (
              <MenuCheck key={f} checked={(page.numbering?.format ?? '1') === f} onSelect={() => setPage({ ...page, numbering: { format: f, start: page.numbering?.start ?? 1 } })}>
                {l}
              </MenuCheck>
            ))}
            <MenuSep />
            <MenuItem
              onSelect={() => {
                const v = window.prompt('First page number', String(page.numbering?.start ?? 1))
                if (v && Number(v) >= 0) setPage({ ...page, numbering: { format: page.numbering?.format ?? '1', start: Math.floor(Number(v)) } })
              }}
            >
              Start at…
            </MenuItem>
          </MenuContent>
        </Menu>
      </Group>
      <Sep />
      <Group label="Indent">
        <span className="ml-1 text-[11.5px] text-text-3">Indent</span>
        <Tip label="Left indent">
          <div>
            <NumberInput label="Left indent" placeholder="L" unit="pt" step={6} min={0} value={s.indentLeft} onChange={(v) => updateBlocks(editor, { indentLeft: v })} width={64} />
          </div>
        </Tip>
        <Tip label="Right indent">
          <div>
            <NumberInput label="Right indent" placeholder="R" unit="pt" step={6} min={0} value={s.indentRight} onChange={(v) => updateBlocks(editor, { indentRight: v })} width={64} />
          </div>
        </Tip>
        <Tip label="First line (negative = hanging)">
          <div>
            <NumberInput label="First line indent" placeholder="1st" unit="pt" step={6} value={s.indentFirst} onChange={(v) => updateBlocks(editor, { indentFirst: v })} width={64} />
          </div>
        </Tip>
      </Group>
      <Sep />
      <Group label="Spacing">
        <span className="ml-1 text-[11.5px] text-text-3">Spacing</span>
        <Tip label="Space before">
          <div>
            <NumberInput label="Space before" placeholder="Before" unit="pt" step={6} min={0} value={s.spaceBefore} onChange={(v) => updateBlocks(editor, { spaceBefore: v })} width={64} />
          </div>
        </Tip>
        <Tip label="Space after">
          <div>
            <NumberInput label="Space after" placeholder="After" unit="pt" step={6} min={0} value={s.spaceAfter} onChange={(v) => updateBlocks(editor, { spaceAfter: v })} width={64} />
          </div>
        </Tip>
      </Group>
      <Sep />
      <Group label="Pagination">
        <TextBtn active={s.keepNext} onClick={() => runCommand('para.keepNext')} label="Keep this paragraph on the same page as the next">
          Keep with next
        </TextBtn>
        <TextBtn active={s.keepLines} onClick={() => runCommand('para.keepLines')} label="Don't split this paragraph across pages">
          Keep lines
        </TextBtn>
        <TextBtn active={s.pageBreakBefore} onClick={() => runCommand('para.pageBreakBefore')} label="Always start this paragraph on a new page">
          Break before
        </TextBtn>
        <Cmd id="para.rtl" label="Right-to-left text" active={editor.state.selection.$from.parent.attrs.dir === 'rtl'} icon={<span className="text-[11px] font-semibold">RTL</span>} />
      </Group>
    </>
  )
}

function CitationStyleMenu() {
  const editor = useBodyEditor()
  const style = useEditorState({ editor, selector: ({ editor: e }) => (e ? styleOf(e.state.doc) : 'apa') }) ?? 'apa'
  if (!editor) return null
  return (
    <Menu>
      <DropBtn label="Citation style">{CITATION_STYLES.find((c) => c.id === style)!.label}</DropBtn>
      <MenuContent>
        {CITATION_STYLES.map((c) => (
          <MenuItem key={c.id} onSelect={() => setCitationStyle(editor, c.id)} className={c.id === style ? 'text-accent' : ''}>
            {c.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

function ReferencesTab() {
  return (
    <>
      <Group label="Table of contents">
        <TextBtn icon={<ListTree />} label="Insert a table of contents built from your headings" onClick={() => runCommand('insert.toc')}>
          Table of contents
        </TextBtn>
        <TextBtn icon={<RefreshCw />} label="Update entries and page numbers" shortcut={shortcutFor('toc.update')} onClick={() => runCommand('toc.update')}>
          Update table
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Links">
        <TextBtn icon={<Link2 />} label="Insert hyperlink" shortcut={shortcutFor('insert.link')} onClick={() => runCommand('insert.link')}>
          Hyperlink
        </TextBtn>
        <TextBtn icon={<BookOpen />} label="Open the navigation pane (document outline)" onClick={() => set({ leftPanel: 'outline' })}>
          Outline
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Citations">
        <TextBtn icon={<Quote />} label="Cite a source at the cursor" onClick={() => openSources(true)}>
          Insert citation
        </TextBtn>
        <TextBtn icon={<BookMarked />} label="Add, edit and delete the sources of this document" onClick={() => openSources(false)}>
          Sources
        </TextBtn>
        <CitationStyleMenu />
        <TextBtn icon={<Library />} label="Insert a reference list of all sources" onClick={() => bodyEditor() && insertBibliography(bodyEditor()!)}>
          Bibliography
        </TextBtn>
        <Cmd id="references.updateCitations" label="Update citations and bibliography" icon={<RefreshCw className="size-4" />} />
      </Group>
      <Sep />
      <Group label="Notes">
        <TextBtn icon={<Superscript />} label="Insert footnote" shortcut={shortcutFor('insert.footnote')} onClick={() => runCommand('insert.footnote')}>
          Footnote
        </TextBtn>
        <TextBtn icon={<Superscript />} label="Insert endnote" shortcut={shortcutFor('insert.endnote')} onClick={() => runCommand('insert.endnote')}>
          Endnote
        </TextBtn>
      </Group>
    </>
  )
}

function TrackToggle() {
  const editor = useBodyEditor()
  const on = useEditorState({ editor, selector: ({ editor: e }) => !!e?.state.doc.attrs.trackChanges }) ?? false
  return (
    <TextBtn icon={<FilePenLine />} active={on} onClick={() => runCommand('review.track')} label="Record insertions and deletions" shortcut={shortcutFor('review.track')}>
      Track changes
    </TextBtn>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 px-2 text-[12px] text-text-3">
      <Info className="size-3.5" />
      {children}
    </span>
  )
}

function ProtectMenu() {
  const editor = useBodyEditor()
  const mode = useEditorState({ editor, selector: ({ editor: e }) => (e?.state.doc.attrs.protection as ProtectionMode | null) ?? null }) ?? null
  if (!editor) return null
  return (
    <Menu>
      <DropBtn label={mode ? 'Protected' : 'Protect'} icon={<Lock />} active={!!mode}>
        {mode ? 'Protected' : 'Protect'}
      </DropBtn>
      <MenuContent>
        <MenuLabel>Allow only</MenuLabel>
        {(Object.keys(PROTECTION_LABELS) as ProtectionMode[]).map((m) => (
          <MenuItem key={m} onSelect={() => setProtection(editor, m)} className={mode === m ? 'text-accent' : ''}>
            {PROTECTION_LABELS[m]}
          </MenuItem>
        ))}
        {mode && (
          <>
            <MenuSep />
            <MenuItem onSelect={() => setProtection(editor, null)}>Stop protection</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}

function ReviewTab() {
  return (
    <>
      <Group label="Proofing">
        <TextBtn icon={<Type />} label="Word count and statistics" shortcut={shortcutFor('tools.stats')} onClick={() => runCommand('tools.stats')}>
          Word count
        </TextBtn>
        <TextBtn icon={<Volume2 />} label="Read the selection (or from the cursor) aloud" onClick={() => runCommand('tools.speak')}>
          Read aloud
        </TextBtn>
        <TextBtn icon={<ShieldCheck />} label="What this file format can and cannot keep" onClick={() => runCommand('tools.compat')}>
          Compatibility
        </TextBtn>
        <TextBtn icon={<Accessibility />} active={useApp((x) => x.rightPanel === 'a11y')} label="Find images without alt text, skipped headings, low contrast and more" onClick={() => runCommand('review.a11y')}>
          Accessibility
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Tracking">
        <TrackToggle />
        <Menu>
          <DropBtn label="Accept" icon={<CheckCheck />}>
            Accept
          </DropBtn>
          <MenuContent>
            <MenuItem onSelect={() => runCommand('review.accept')}>Accept and move to next</MenuItem>
            <MenuItem onSelect={() => runCommand('review.acceptAll')}>Accept all changes</MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <DropBtn label="Reject" icon={<XCircle />}>
            Reject
          </DropBtn>
          <MenuContent>
            <MenuItem onSelect={() => runCommand('review.reject')}>Reject and move to next</MenuItem>
            <MenuItem onSelect={() => runCommand('review.rejectAll')}>Reject all changes</MenuItem>
          </MenuContent>
        </Menu>
        <Cmd id="review.prevChange" label="Previous change" icon={<ArrowUpToLine className="size-4" />} />
        <Cmd id="review.nextChange" label="Next change" icon={<ArrowDownToLine className="size-4" />} />
        <TextBtn icon={<Eye />} active={useApp((x) => x.showMarkup)} onClick={() => runCommand('review.markup')} label="Show insertions and deletions (off = final text)">
          Markup
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Protect">
        <ProtectMenu />
      </Group>
      <Sep />
      <Group label="Compare">
        <Menu>
          <DropBtn label="Compare" icon={<GitCompare />}>
            Compare
          </DropBtn>
          <MenuContent>
            <MenuItem onSelect={() => runCommand('review.compare')}>With another document…</MenuItem>
            <MenuItem onSelect={() => runCommand('file.history')}>With a saved version…</MenuItem>
          </MenuContent>
        </Menu>
      </Group>
      <Sep />
      <Group label="Comments">
        <TextBtn icon={<MessageSquarePlus />} label="Comment on the selected text" shortcut={shortcutFor('review.comment')} onClick={() => runCommand('review.comment')}>
          New comment
        </TextBtn>
        <Cmd id="review.prevComment" label="Previous comment" icon={<ChevronUp className="size-4" />} />
        <Cmd id="review.nextComment" label="Next comment" icon={<ChevronDown className="size-4" />} />
        <TextBtn icon={<MessagesSquare />} active={useApp((x) => x.rightPanel === 'comments')} onClick={() => runCommand('review.showComments')}>
          Show comments
        </TextBtn>
      </Group>
    </>
  )
}

function ViewTab() {
  const st = useApp(useShallow((x) => ({ zoom: x.zoom, left: !!x.leftPanel, right: !!x.rightPanel, marks: x.showMarks, bounds: x.showBoundaries, focus: x.focusMode, ruler: x.settings.showRuler, dark: x.dark })))
  return (
    <>
      <Group label="Zoom">
        <Cmd id="view.zoomOut" label="Zoom out" icon={<ZoomOut className="size-4" />} />
        <button onClick={() => zoomTo(1)} className="h-7 w-12 rounded-md text-[12.5px] tabular-nums text-text-2 hover:bg-hover" aria-label="Reset zoom">
          {Math.round(st.zoom * 100)}%
        </button>
        <Cmd id="view.zoomIn" label="Zoom in" icon={<ZoomIn className="size-4" />} />
        <TextBtn icon={<Maximize2 />} onClick={() => fitWidth()}>
          Page width
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Show">
        <TextBtn icon={<PanelLeft />} active={st.left} onClick={() => runCommand('view.outline')} label="Navigation pane" shortcut={shortcutFor('view.outline')}>
          Navigation
        </TextBtn>
        <TextBtn icon={<PanelRight />} active={st.right} onClick={() => runCommand('view.inspector')} label="Format panel" shortcut={shortcutFor('view.inspector')}>
          Format panel
        </TextBtn>
        <TextBtn icon={<Ruler />} active={st.ruler} onClick={() => runCommand('view.ruler')}>
          Ruler
        </TextBtn>
        <TextBtn icon={<SquareDashed />} active={st.bounds} onClick={() => runCommand('view.boundaries')}>
          Margins
        </TextBtn>
        <TextBtn icon={<Pilcrow />} active={st.marks} onClick={() => runCommand('view.marks')}>
          Marks
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Modes">
        <TextBtn icon={<Focus />} active={st.focus} onClick={() => runCommand('view.focus')} label="Distraction-free writing" shortcut={shortcutFor('view.focus')}>
          Focus
        </TextBtn>
        <TextBtn icon={<FileCode2 />} active={useApp((x) => x.tabs.find((t) => t.id === x.active)?.mode === 'source')} onClick={() => runCommand('view.source')} label="Edit as Markdown source with live preview" shortcut={shortcutFor('view.source')}>
          Markdown
        </TextBtn>
        <TextBtn icon={<Moon />} active={st.dark} onClick={() => runCommand('view.theme')}>
          Dark
        </TextBtn>
      </Group>
    </>
  )
}

export function fitWidth() {
  const el = document.querySelector<HTMLElement>(`[data-doc-scroll]:not([hidden])`)
  const editor = document.querySelector<HTMLElement>('[data-page-stack]')
  if (!el || !editor) return
  zoomTo((el.clientWidth - 140) / editor.offsetWidth)
}

function MailMergeGroup() {
  const editor = useBodyEditor()
  const active = useApp((x) => x.active)
  const m = useApp((x) => x.merge[x.active])
  if (!editor) return null
  const fields = m?.data.fields ?? []
  return (
    <Group label="Mail merge">
      <TextBtn icon={<Users />} label={m ? `${m.data.name}: ${m.data.rows.length} recipients` : 'Choose a CSV file with one row per recipient'} onClick={() => void selectRecipients(active)}>
        {m ? `${m.data.rows.length} recipients` : 'Recipients…'}
      </TextBtn>
      <Menu>
        <DropBtn label="Insert merge field" icon={<Braces />}>
          Insert field
        </DropBtn>
        <MenuContent>
          {fields.length ? fields.map((f) => <MenuItem key={f} onSelect={() => insertMergeField(editor, f)}>{f}</MenuItem>) : <MenuLabel>Choose recipients first</MenuLabel>}
        </MenuContent>
      </Menu>
      {m && (
        <>
          <TextBtn icon={<Eye />} active={m.preview !== null} label="Show the values of a recipient in place of the fields" onClick={() => previewRecord(m.preview === null ? 0 : null, active)}>
            Preview
          </TextBtn>
          {m.preview !== null && (
            <span className="flex items-center text-[12px] tabular-nums text-text-2">
              <IconBtn label="Previous recipient" size="sm" onClick={() => previewRecord(m.preview! - 1, active)}>
                <ChevronLeft className="size-3.5" />
              </IconBtn>
              {m.preview + 1}/{m.data.rows.length}
              <IconBtn label="Next recipient" size="sm" onClick={() => previewRecord(m.preview! + 1, active)}>
                <ChevronRight className="size-3.5" />
              </IconBtn>
            </span>
          )}
          <TextBtn icon={<Merge />} label="Create one document with a copy for every recipient" onClick={() => finishMerge(active)}>
            Finish & merge
          </TextBtn>
        </>
      )}
    </Group>
  )
}

function ToolsTab() {
  return (
    <>
      <Group label="Assistant">
        <TextBtn icon={<Sparkles />} label="Rewrite, proofread or summarize the selection with Claude (optional, off until you turn it on)" onClick={() => runCommand('tools.ai')}>
          AI assistant
        </TextBtn>
      </Group>
      <Sep />
      <MailMergeGroup />
      <Sep />
      <Group label="Tools">
        <TextBtn icon={<Type />} onClick={() => runCommand('tools.stats')}>
          Statistics
        </TextBtn>
        <TextBtn icon={<Volume2 />} onClick={() => runCommand('tools.speak')}>
          Read aloud
        </TextBtn>
        <TextBtn icon={<FileCode2 />} onClick={() => runCommand('view.source')}>
          Markdown source
        </TextBtn>
      </Group>
      <Sep />
      <Group label="App">
        <TextBtn icon={<Keyboard />} onClick={() => runCommand('tools.shortcuts')}>
          Shortcuts
        </TextBtn>
        <TextBtn icon={<Settings />} onClick={() => runCommand('tools.settings')}>
          Settings
        </TextBtn>
        <TextBtn icon={<Printer />} onClick={() => runCommand('file.print')}>
          Print
        </TextBtn>
      </Group>
    </>
  )
}

function TableTab() {
  return (
    <>
      <Group label="Rows & columns">
        <TextBtn icon={<AlignStartVertical />} onClick={() => runCommand('table.addRowBefore')}>
          Row above
        </TextBtn>
        <TextBtn icon={<AlignEndVertical />} onClick={() => runCommand('table.addRowAfter')}>
          Row below
        </TextBtn>
        <TextBtn icon={<Plus />} onClick={() => runCommand('table.addColBefore')}>
          Col left
        </TextBtn>
        <TextBtn icon={<Plus />} onClick={() => runCommand('table.addColAfter')}>
          Col right
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Cells">
        <TextBtn icon={<Merge />} onClick={() => runCommand('table.merge')}>
          Merge
        </TextBtn>
        <TextBtn icon={<Split />} onClick={() => runCommand('table.split')}>
          Split
        </TextBtn>
        <TextBtn icon={<Rows3 />} onClick={() => runCommand('table.headerRow')}>
          Header row
        </TextBtn>
        <CellShading />
        <Cmd id="table.alignTop" label="Align top" icon={<AlignVerticalJustifyStart className="size-4" />} />
        <Cmd id="table.alignMiddle" label="Align middle" icon={<AlignVerticalJustifyCenter className="size-4" />} />
        <Cmd id="table.alignBottom" label="Align bottom" icon={<AlignVerticalJustifyEnd className="size-4" />} />
      </Group>
      <Sep />
      <Group label="Table">
        <TableStyleMenu />
        <Cmd id="table.sortAsc" label="Sort by this column, A → Z" icon={<ArrowDownAZ className="size-4" />} />
        <Cmd id="table.sortDesc" label="Sort by this column, Z → A" icon={<ArrowUpZA className="size-4" />} />
        <TextBtn icon={<Columns3 />} onClick={() => runCommand('table.distribute')} label="Make all columns the same width">
          Distribute
        </TextBtn>
        <TextBtn icon={<Pilcrow />} onClick={() => runCommand('table.toText')} label="Replace the table with tab-separated paragraphs">
          To text
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Delete">
        <TextBtn icon={<Trash2 />} onClick={() => runCommand('table.deleteRow')}>
          Row
        </TextBtn>
        <TextBtn icon={<Trash2 />} onClick={() => runCommand('table.deleteCol')}>
          Column
        </TextBtn>
        <TextBtn icon={<Trash2 />} onClick={() => runCommand('table.delete')}>
          Table
        </TextBtn>
      </Group>
    </>
  )
}

function TableStyleMenu() {
  const editor = useActiveEditor()
  if (!editor) return null
  const current = (editor.getAttributes('table').tableStyle as TableStyle | null) ?? 'grid'
  return (
    <Menu>
      <DropBtn label="Table style" icon={<Table2 />}>
        Style
      </DropBtn>
      <MenuContent>
        {TABLE_STYLES.map((t) => (
          <MenuCheck key={t.id} checked={current === t.id} onSelect={() => setTableStyle(editor, t.id)}>
            {t.label}
          </MenuCheck>
        ))}
      </MenuContent>
    </Menu>
  )
}

function CellShading() {
  const editor = useActiveEditor()
  if (!editor) return null
  return (
    <ColorBtn
      label="Cell shading"
      icon={<PaintBucket />}
      color={(editor.getAttributes('tableCell').background as string) ?? null}
      onPick={(c) => editor.chain().focus().setCellAttribute('background', c).run()}
      onClear={() => editor.chain().focus().setCellAttribute('background', null).run()}
      clearLabel="No shading"
    />
  )
}

function ImageTab({ editor }: { editor: Editor }) {
  const a = editor.getAttributes('image')
  const setF = (float: string | null) => editor.chain().focus().updateAttributes('image', { float }).run()
  return (
    <>
      <Group label="Wrap">
        <TextBtn active={!a.float} onClick={() => setF(null)}>
          In line
        </TextBtn>
        <TextBtn active={a.float === 'left'} onClick={() => setF('left')}>
          Wrap left
        </TextBtn>
        <TextBtn active={a.float === 'right'} onClick={() => setF('right')}>
          Wrap right
        </TextBtn>
      </Group>
      <Sep />
      <Group label="Size">
        <TextBtn onClick={() => editor.chain().focus().updateAttributes('image', { width: null, height: null }).run()}>Reset size</TextBtn>
      </Group>
      <Sep />
      <Group label="Accessibility">
        <TextBtn
          icon={<Eye />}
          onClick={() => {
            const alt = window.prompt('Alternative text (describe the image for screen readers)', a.alt ?? '')
            if (alt != null) editor.chain().focus().updateAttributes('image', { alt }).run()
          }}
        >
          Alt text
        </TextBtn>
      </Group>
    </>
  )
}

export function Ribbon() {
  const editor = useActiveEditor()
  const s = useSnapshot(editor)
  const { tab, collapsed } = useApp(useShallow((x) => ({ tab: x.ribbonTab, collapsed: x.settings.ribbonCollapsed })))
  const [ctx, setCtx] = useState<'table' | 'image' | null>(null)
  const contextual = s.image ? 'image' : s.inTable ? 'table' : null
  const shown = ctx && ctx === contextual ? ctx : tab
  if (!editor) return null

  return (
    <div className="shrink-0 border-b border-border bg-panel" data-testid="ribbon">
      <div className="flex h-9 items-center gap-0.5 px-2" role="tablist" aria-label="Ribbon">
        <button
          onClick={() => set((x) => ({ backstage: !x.backstage }))}
          className="mr-1 h-[26px] rounded-md bg-accent px-3 text-[12.5px] font-semibold text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] hover:brightness-110"
        >
          File
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={shown === t.id && !collapsed}
            onClick={() => {
              setCtx(null)
              set({ ribbonTab: t.id })
              if (collapsed) void updateSettings({ ribbonCollapsed: false })
            }}
            className={cx('relative h-[26px] rounded-md px-2.5 text-[12.5px] font-medium transition-colors', shown === t.id && !collapsed ? 'text-text' : 'text-text-2 hover:bg-hover hover:text-text')}
          >
            {t.label}
            {shown === t.id && !collapsed && <span className="absolute inset-x-2.5 -bottom-[5px] h-[2px] rounded-full bg-accent" />}
          </button>
        ))}
        {contextual && (
          <button
            role="tab"
            aria-selected={shown === contextual}
            onClick={() => setCtx(contextual)}
            className={cx('relative ml-1 h-[26px] rounded-md px-2.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft', shown === contextual && 'bg-accent-soft')}
          >
            {contextual === 'table' ? 'Table' : 'Picture'}
          </button>
        )}
        <div className="flex-1" />
        <IconBtn label="Undo" size="sm" shortcut={shortcutFor('edit.undo')} disabled={!s.canUndo} onClick={() => runCommand('edit.undo')}>
          <Undo2 className="size-3.5" />
        </IconBtn>
        <IconBtn label="Redo" size="sm" shortcut={shortcutFor('edit.redo')} disabled={!s.canRedo} onClick={() => runCommand('edit.redo')}>
          <Redo2 className="size-3.5" />
        </IconBtn>
        <IconBtn label={collapsed ? 'Expand ribbon' : 'Collapse ribbon'} size="sm" shortcut={shortcutFor('view.ribbon')} onClick={() => runCommand('view.ribbon')}>
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </IconBtn>
      </div>
      {!collapsed && (
        <div className="flex h-11 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-2 [scrollbar-width:none]" role="toolbar" aria-label={`${shown} tools`}>
          {shown === 'home' && <HomeTab editor={editor} s={s} />}
          {shown === 'insert' && <InsertTab editor={editor} />}
          {shown === 'layout' && <LayoutTab editor={editor} s={s} />}
          {shown === 'references' && <ReferencesTab />}
          {shown === 'review' && <ReviewTab />}
          {shown === 'view' && <ViewTab />}
          {shown === 'tools' && <ToolsTab />}
          {shown === 'table' && <TableTab />}
          {shown === 'image' && <ImageTab editor={editor} />}
        </div>
      )}
    </div>
  )
}
