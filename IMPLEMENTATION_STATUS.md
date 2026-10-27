# Implementation status

_Last updated: 2026-10-27 · Milestone 1 complete · Milestone 2 in progress._

"Done" means implemented **and** covered by a passing automated test or a manual check recorded below. A button existing in the UI does not count.

## Test results (current)

| Suite | Result |
|---|---|
| `npm run typecheck` (strict, main + renderer) | ✅ clean |
| `npm test` (vitest) | ✅ 64 / 64 |
| `npm run e2e:headless` (Playwright + Electron) | ✅ 13 / 13 |
| Independent consumer: our DOCX → LibreOffice → PDF | ✅ (in `docx.test.ts`) |

Acceptance criteria from the brief:

| # | Criterion | Status | Test |
|---|---|---|---|
| 1 | Formatted paragraphs | ✅ | e2e `acceptance 1–11` |
| 2 | Headings, nested bullet lists | ✅ | e2e `acceptance 1–11` |
| 3 | Insert & format a table | ✅ | e2e `acceptance 1–11` |
| 4 | Images | ✅ | e2e `acceptance 1–11` |
| 5 | Page break | ✅ | e2e `acceptance 1–11` |
| 6 | Margins | ✅ (via ribbon) | e2e `acceptance 1–11` |
| 7–9 | Save DOCX, close, reopen, content and formatting intact | ✅ | e2e `acceptance 1–11`, unit `docx.test.ts` |
| 10–11 | Export PDF; page count and per-page content | ✅ PDF pages = editor pages | e2e `acceptance 1–11` (`pdfinfo`, `pdftotext`) |
| 12–13 | Open ODT, edit, save | ✅ native ODT engine (no LibreOffice) | e2e `acceptance 12–13`, unit `odt.test.ts` |
| 14 | Markdown import/export | ✅ | e2e `acceptance 14` |
| 15–16 | Annotate PDF, save, reopen | ⏳ Milestone 3 | — |
| 17 | Undo/redo | ✅ | e2e `acceptance 17 & 19` |
| 18 | AutoSave and crash recovery (SIGKILL) | ✅ | e2e `acceptance 18` |
| 19 | Keyboard shortcuts | ✅ | e2e `acceptance 17 & 19` |
| 20 | App builds | ✅ | `npm run e2e` builds first |

**Performance** (240 pages, 2,460 paragraphs, 20 tables; measured under xvfb):

| Measure | Result |
|---|---|
| Full pagination pass | 30 ms |
| Keystroke → painted frame, median | 43 ms (includes the two-frame wait) |
| Keystroke → painted frame, worst | 84 ms |

Two optimizations got there. ProseMirror `posAtCoords` (O(characters)) was replaced by a lazy binary search over character boxes, and `doc.resolve` / `nodeDOM` (O(n²) overall) was replaced by one walk of the view tree.

## Milestone 1 — Functional foundation ✅

### Done

- **App shell.**
  - Custom title bar: logo, document tabs with dirty indicators and middle-click close, save status, undo/redo, find, Export menu, theme toggle and settings.
  - Native window-controls overlay on Windows and Linux (custom controls are the fallback), and the hidden-inset traffic lights on macOS.
- **Ribbon.**
  - Tabs: File (backstage), Home, Insert, Layout, References, Review, View and Tools, plus contextual **Table** and **Picture** tabs.
  - The ribbon collapses, shows shortcut tooltips, and drops lower-priority controls on narrow windows.
- **Floating selection toolbar and context menu.** The context menu covers clipboard, links and table operations.
- **Dashboard.** Templates (Blank, Report, Letter, Meeting notes, Résumé, Essay), recent files with page thumbnails, pin and favorite, search and filters, recovered documents, and drag-and-drop to open.
- **Editor.**
  - Character formatting: bold, italic, underline, strike, double strike, sub/superscript, font family (system fonts through Local Font Access), size, grow/shrink, color, highlight, all caps, small caps, character spacing, inline code, clear formatting, format painter and change case (5 modes).
  - Paragraph formatting: alignment, line spacing, space before/after, left/right/first-line/hanging indents, shading, keep with next, keep lines together, page break before and RTL.
  - Named styles stored in the document: Normal, Title, Subtitle, Heading 1–9, Quote, Caption and No Spacing. They are generated as CSS, so changing a style restyles every paragraph that uses it.
  - Lists: bulleted (custom bullets), numbered (1, a, A, i, I and 1.1 outline formats, start/restart), checklists, and Tab/Shift-Tab level changes.
  - Tables: insert grid, rows/columns, merge/split, header row, cell shading, column resize.
  - Images: insert, paste, drag-drop, resize handles, inline / wrap left / wrap right, alt text.
  - Links (dialog, Ctrl/Cmd+K, open in browser), page breaks (Ctrl/Cmd+Enter splits the paragraph like Word), horizontal rule, block quote, code block, symbols, date.
- **Real pagination.**
  - Line-level splitting with widow/orphan control (2 lines), keep-with-next chains, keep-lines-together, page-break-before, forced breaks and table row breaks.
  - List markers and table wrappers move with their content.
  - Page size (Letter, A4, Legal, A3, A5, custom), orientation, margin presets and custom values, page color.
  - Rulers with draggable margins and indents, margin guides, zoom from 25 to 500% (layout is zoom-invariant), and Ctrl+wheel zoom.
- **Navigation.** Outline pane, pages pane, recent pane. Format / Page / Stats inspector. Status bar with page X of N, words, characters, language, mode, format and a zoom slider.
- **Find and replace.** Match case, whole word, regex (with `$1` groups), search within selection, next/previous, replace and replace all.
- **Files.**
  - Open and save through native dialogs, with atomic writes (temp file, fsync, rename).
  - Save As / Export to DOCX, ODT, RTF, Markdown, HTML and TXT. Lossy targets show an explicit "what will be lost" confirmation.
  - Recents, drag-and-drop, file arguments and macOS `open-file`, a single-instance lock, and file-association config for packaging.
- **AutoSave.** Configurable delay. It pauses for files with compatibility warnings until you save manually. **AutoRecovery** snapshots every few seconds and offers them back on the next launch; verified with SIGKILL.
- **PDF export and printing.** The paginated DOM is sliced into fixed pages and rendered through Chromium (`printToPDF` / native print). Text is selectable, links work, fonts are embedded, and the document outline comes from headings.
- **Formats.** See COMPATIBILITY.md. In short:
  - Own DOCX reader/writer with passthrough of unsupported XML and parts.
  - Markdown (CommonMark + GFM tables, task lists, strikethrough), with a WYSIWYG mode and a source mode (CodeMirror plus live preview).
  - HTML (sanitized) and TXT (encoding detection, form-feed page breaks).
  - ODT, RTF and DOC through LibreOffice.
- **Settings.** Theme (light, dark, system), accent color, interface size, reduced motion, ruler, default font, size, page and margins, default save format, autosave and recovery intervals, language, author, and customizable keyboard shortcuts.
- **Accessibility basics.** Semantic roles (tablist, toolbar, dialog, slider, search), labelled icon buttons, visible focus rings, keyboard-reachable ribbon and dialogs (Radix), `prefers-reduced-motion` plus an in-app reduced-motion setting, and a scalable UI.

### Known limitations (M1)

- **Font metrics and line heights.**
  - Line height approximates Word's "single" spacing with a per-font factor. Page breaks can differ from Word for the same document, even though our PDF always matches our editor.
  - Exact and at-least line spacing from DOCX are approximated as multiples.
- **Pagination.**
  - Table rows taller than one page overflow; they are not split.
  - Floating images are measured with their anchoring paragraph only.
  - A blockquote's left border is drawn across the gap between pages.
  - Repeated header rows on continuation pages are not drawn yet.
- **DOCX not editable yet.** Headers/footers, footnotes/endnotes, comments, tracked changes, multiple sections, multi-column layout, paragraph borders, custom tab stops, equations, charts and shapes are not editable. They are either preserved and written back, or reported in the compatibility dialog (comments, tracked changes).
- **Spell checking.** Spell checking on Linux is off, because Electron would download dictionaries from a CDN; bundled dictionaries arrive in M2. macOS and Windows use the OS spell checker.
- **Images** are stored inline as data URLs. Simple, but large image-heavy documents use more memory.
- **Unit placeholders.** The References and Review tabs show only working items (links, outline, word count, read-aloud, compatibility). TOC, footnotes, comments and track changes are M2.

## Milestone 2 — Advanced document editing 🟡 in progress

### Done (each with unit + E2E tests)
- **Headers & footers**: edited in place (double-click a margin or Insert → Header/Footer); default / different first page / odd-even; fields PAGE, NUMPAGES, DATE, TITLE, AUTHOR; Insert → Page number presets; page-number format (1, i, I, a, A) and start value; rendered on sheets and in PDF; DOCX header/footer parts (with their own image relationships), `titlePg`, `evenAndOddHeaders`, `pgNumType` read and written.
- **Table of contents**: References → Table of contents / Update table (F9); page numbers from the live layout (settles in ≤3 passes); Ctrl/Cmd-click jumps to the heading; written as Word's TOC content control + `TOC \o` field with dot-leader tabs, read back as a TOC.
- **Footnotes & endnotes**: Ctrl+Alt+F / Ctrl+Alt+D; numbered automatically (1,2,3 / i,ii,iii); the layout engine reserves note space on the page of each reference (paragraph splits account for notes on their lines); notes edited in a popover from the reference or the note; endnotes on the last page; DOCX `footnotes.xml`/`endnotes.xml` round trip; Markdown GFM footnotes; TXT notes list.
- **Comments**: Ctrl+Alt+M on a selection; threaded replies, resolve/reopen, delete, next/previous, right-panel Comments tab; overlapping ranges; DOCX `comments.xml` + `commentsExtended.xml` (threads, resolved state).
- **Track changes**: Ctrl+Shift+T; insertions/deletions recorded per author (minute-resolution timestamps so typing merges), deleting your own insertion is a real delete, one undo step per edit; accept/reject at cursor or all, next/previous change, Markup/Final view, status-bar indicator; DOCX `w:ins`/`w:del`/`w:trackRevisions` round trip; Markdown/TXT export the final text.
- **Native ODT reader/writer** (no LibreOffice): styles, formatting, lists, tables with spans, images, links, notes, comments with replies, headers/footers with fields, page layout, TOC, page breaks, metadata; unknown ODF content preserved. Tested against a LibreOffice-authored fixture, by round trip, and by LibreOffice rendering our output.
- **Spell checking (offline)**: nspell in a Web Worker with bundled English (US/UK) Hunspell dictionaries; other languages use system Hunspell dictionaries on Linux; wavy underlines, right-click suggestions, Add to dictionary (persisted), Ignore all. Chromium's own spellchecker is disabled (it would download dictionaries).

### Remaining in M2
7. Grammar checking — harper.js evaluated (Apache-2.0) but its package is ~95 MB unpacked; deferred until a slimmer build is chosen.
8. Style editor dialog and custom styles; advanced tables (borders, padding, sort, distribute, text↔table, repeated header row on continuation pages, can't-split rows).
10. Section breaks with per-section page setup and columns (currently: last section's setup, warned).

### Performance note
Pagination is now **incremental**: units are measured lazily, a pass resumes one page before the edited range and stops as soon as a new break coincides with an old one past the edit (the rest of the old layout is reused, shifted). Full passes still run for page-setup/style changes, font and image loads. On the 240-page benchmark with spell checking on (~5,000 misspelling decorations): keystroke → frame median **42 ms** (was 66 ms), full pass 38 ms; the E2E test asserts the incremental layout equals a fresh full pass after a large edit.

## Milestone 2 — original plan (for reference)

Planned, in order:

1. Headers and footers: default, first page and odd/even. Editable in place on the page sheet, with PAGE, NUMPAGES, title and date fields, and DOCX read/write replacing passthrough.
2. Page numbering formats and restart. Section breaks with per-section page setup, plus a column layout, which may be partial.
3. Footnotes and endnotes. The layout engine reserves footnote area per page.
4. Table of contents, refreshable, with page numbers taken from the layout.
5. Comments as a mark plus a thread store in the right panel, round-tripped through DOCX `comments.xml`.
6. Track Changes: insert/delete marks through transaction filtering, accept/reject, DOCX `w:ins`/`w:del`.
7. Spell checking with bundled Hunspell dictionaries and no network access. Grammar through harper.js (offline WASM).
8. Style editor dialog and custom styles. Advanced tables: borders, padding, sort, distribute, convert text↔table, repeat header row, can't-split rows.
9. Native ODT reader/writer with loss warnings, removing the dependence on LibreOffice for ODT.

## Milestones 3–5 ⏳

See the plan in the README and the original brief.

- **M3:** PDF workspace on PDFium WASM. Includes true redaction and editing of existing text objects (with honest font-substitution limits) and optional OCR with tesseract.js.
- **M4:** Compare, citations, mail merge, equations, shapes and charts, protection, version history and an optional AI assistant.
- **M5:** Packaging and signing, accessibility audit (axe), compatibility regression corpus, release docs.

## Next recommended tasks

1. Style editor + table tools (M2 item 8), including repeated header rows in the paginator (the row-spacer widget can carry a cloned header).
2. Section breaks with per-section page setup (M2 item 10).
4. Then Milestone 3 (PDF workspace on PDFium WASM).
