# Implementation status

_Last updated: 2026-10-27 · Milestones 1–4 complete (each with documented partial items) · Milestone 5 next._

"Done" means implemented **and** covered by a passing automated test or a manual check recorded below. A button existing in the UI does not count.

## Test results (current)

| Suite | Result |
|---|---|
| `npm run typecheck` (strict, main + renderer) | ✅ clean |
| `npm test` (vitest) | ✅ 129 / 129 |
| `npm run e2e:headless` (Playwright + Electron) | ✅ 29 / 29 (every test also fails on any Content-Security-Policy violation) |
| Independent consumer: our DOCX → LibreOffice → PDF | ✅ (in `docx.test.ts`) |
| Independent consumer: our edited PDFs → poppler (`pdftotext`, `pdfinfo`) | ✅ (in `pdf.test.ts`, `ocr.test.ts`, e2e `pdf.spec.ts`) |

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
| 15–16 | Annotate PDF, save, reopen | ✅ highlight + note + text edit + redaction + rotation + form field, saved and reopened | e2e `acceptance 15–16` (checked with `pdftotext`) |
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

## Milestone 2 — Advanced document editing ✅ (two items partial, see below)

### Done (each with unit + E2E tests)
- **Headers & footers**: edited in place (double-click a margin or Insert → Header/Footer); default / different first page / odd-even; fields PAGE, NUMPAGES, DATE, TITLE, AUTHOR; Insert → Page number presets; page-number format (1, i, I, a, A) and start value; rendered on sheets and in PDF; DOCX header/footer parts (with their own image relationships), `titlePg`, `evenAndOddHeaders`, `pgNumType` read and written.
- **Table of contents**: References → Table of contents / Update table (F9); page numbers from the live layout (settles in ≤3 passes); Ctrl/Cmd-click jumps to the heading; written as Word's TOC content control + `TOC \o` field with dot-leader tabs, read back as a TOC.
- **Footnotes & endnotes**: Ctrl+Alt+F / Ctrl+Alt+D; numbered automatically (1,2,3 / i,ii,iii); the layout engine reserves note space on the page of each reference (paragraph splits account for notes on their lines); notes edited in a popover from the reference or the note; endnotes on the last page; DOCX `footnotes.xml`/`endnotes.xml` round trip; Markdown GFM footnotes; TXT notes list.
- **Comments**: Ctrl+Alt+M on a selection; threaded replies, resolve/reopen, delete, next/previous, right-panel Comments tab; overlapping ranges; DOCX `comments.xml` + `commentsExtended.xml` (threads, resolved state).
- **Track changes**: Ctrl+Shift+T; insertions/deletions recorded per author (minute-resolution timestamps so typing merges), deleting your own insertion is a real delete, one undo step per edit; accept/reject at cursor or all, next/previous change, Markup/Final view, status-bar indicator; DOCX `w:ins`/`w:del`/`w:trackRevisions` round trip; Markdown/TXT export the final text.
- **Native ODT reader/writer** (no LibreOffice): styles, formatting, lists, tables with spans, images, links, notes, comments with replies, headers/footers with fields, page layout, TOC, page breaks, metadata; unknown ODF content preserved. Tested against a LibreOffice-authored fixture, by round trip, and by LibreOffice rendering our output.
- **Table tools**: header rows repeat at the top of continuation pages (screen, print and PDF; the layout reserves their height); table styles Grid / Plain / Horizontal lines / Striped (DOCX + ODT round trip); sort by the current column (numeric-aware, header kept, refuses vertical merges); distribute columns; text ↔ table (keeps formatting); cell vertical alignment.
- **Style editor**: Modify style / New style (name, based-on, next style, font, size, B/I/U, color, alignment, spacing, indents, keep options, live preview); "Update style to match selection" folds direct formatting into the style and clears it from the paragraph. Undoable; every paragraph using the style updates.
- **Section breaks (partial)**: section breaks from DOCX are kept as nodes with their original settings (orientation, size, columns, numbering) and written back verbatim; they paginate as next/odd/even page or continuous breaks. The editor shows every section with the document's page setup (reported in the compatibility dialog). New section breaks are not yet offered in the UI.
- **Spell checking (offline)**: nspell in a Web Worker with bundled English (US/UK) Hunspell dictionaries; other languages use system Hunspell dictionaries on Linux; wavy underlines, right-click suggestions, Add to dictionary (persisted), Ignore all. Chromium's own spellchecker is disabled (it would download dictionaries).

### Partial / deferred in M2
- **Grammar checking** — harper.js (Apache-2.0, offline WASM) evaluated; its package is ~95 MB unpacked, so it is deferred until a slimmer build is selected.
- **Per-section page setup and columns** — preserved and round-tripped, not displayed (every section uses the document's page setup in the editor). Doing it properly needs per-section text widths in the single-column flow.
- **Rows taller than a page** are not split (they overflow the page).

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

## Milestone 3 — PDF workspace ✅ (limits listed below)

PDF files open in their own workspace tab, built on PDFium compiled to WebAssembly (`@embedpdf/pdfium`). PDFium runs in a Web Worker. The ribbon is replaced by a PDF toolbar.

### Done (each with unit and/or E2E tests)
- **Viewing**: pages render lazily as they scroll into view. Includes zoom, fit-to-width on open, thumbnails, search with hit highlighting and next/previous, and a selectable text layer for copying.
- **Markup annotations**: highlight, underline and strike-through from a text selection; sticky notes; freehand ink. Each carries the author name from Settings. The Comments panel lists them, jumps to them and deletes them. They are standard PDF annotations, so other readers show them too.
- **Editing existing text (not an overlay)**: click a line and type the replacement. The line's text objects in the page content are rewritten and the content stream is regenerated. The original font is kept when its embedded subset already holds every new character. Otherwise a standard font is substituted and the user is told which one (Times, Helvetica or Courier, picked from the original's flags and name). Tests read the result back with `pdftotext`, and a pixel check confirms every new character is actually drawn.
- **Adding content**: new text, plus signatures or images. A signature can be drawn on a pad or loaded from an image file, and is placed as an image object.
- **True redaction**: mark areas, then apply after a confirmation. PDFium's redaction removes the content under each area from the file, and a black box is drawn in its place. Tests confirm with `pdftotext` that redacted text is gone from the saved file and that the same text on other pages is untouched.
- **Pages**: rotate, delete, insert a blank page, move up/down, merge (append another PDF), extract a page to a new PDF, split after a page, and crop (sets the CropBox).
- **Forms**: fill text fields and checkboxes on the page or in the Form fields panel. New text fields and checkboxes can be created by dragging.
- **Metadata**: title, author, subject and keywords.
- **OCR (offline)**: *Recognize text* runs Tesseract (tesseract.js with the bundled 2.9 MB English model) on every page that has no text layer. The words are added as an invisible text layer positioned over the image, so the page looks unchanged but can be searched, selected and indexed. The unit test confirms the rendering is pixel-identical and that search hits land on the word in the image. The model runs in the main process on a worker thread and never touches the network.
- **Password-protected PDFs**: a password prompt appears, and a wrong password is reported. The file stays encrypted with the same password when saved (checked with poppler).
- **Saving, undo, printing**: Save and Save as write a new full file atomically. Ctrl+Z restores whole-document snapshots (15 levels). Ctrl+P prints each page on a sheet of its own size.

### Known limitations (M3)
- **Text edits are line-level and do not reflow.** Replacement text is the same size and position as the line it replaces. Longer text runs past the line and nothing moves out of its way.
- **The substitute standard fonts only cover Latin-1 (WinAnsi).** Characters outside it, such as Greek, Cyrillic or CJK, cannot be typed into a substituted line. Text is not auto-fitted either: a substituted font of a different width changes the line length.
- **Rotated pages show no text layer.** Text selection, markup and text editing are available only on pages with 0° rotation. Rotate the page back to edit it.
- **Redaction coverage is partly verified.** Removing text is tested. Removing images and vector graphics under a redaction area is left to PDFium's redaction routine, which no test of ours covers yet.
- **Annotations can only be added or deleted.** Existing annotations cannot be moved, resized or edited, and comment threads (replies) are not supported.
- **Only text and checkbox form fields are editable.** Radio buttons, combo boxes and list boxes are shown read-only, and form JavaScript is never run.
- **Signatures are not cryptographic.** *Sign* places a picture of a signature, not a digital (certificate) signature. Editing a digitally signed PDF invalidates its signature, and the app does not warn about this yet.
- **Permission flags are not enforced.** On a protected PDF, restrictions such as "no editing" are ignored once the file is opened.
- **Undo works on whole-file snapshots.** There is no redo, and undo history is capped at 15 steps.
- **Crop hides content instead of removing it.** It sets the CropBox, so content outside the box stays in the file. Use redaction to remove content.
- **Printing is raster.** Pages print as 150 dpi images.
- **OCR is English only.**

### Security hardening done alongside M3
The packaged renderer now has a strict Content-Security-Policy:
- no inline or remote scripts
- WebAssembly is allowed, but `eval` is not
- `object-src` and `frame-src` are set to `'none'`

Every E2E test fails if Chromium reports a CSP violation. A test also confirms that an injected inline script is blocked.

## Milestone 4 — Professional features ✅ (limits listed below)

### Done (each with unit and E2E tests)
- **Compare documents** (Review → Compare, or from Version history). Blocks are aligned first, then paired paragraphs are compared word by word, and lists and tables are compared recursively. Tables keep their shape. The result opens in a new tab as tracked changes, so Accept and Reject work on it as usual. The current file is compared against a saved file or a saved version. Accepting or rejecting a change that covers a whole paragraph removes the paragraph. Tested on the DOCX fixture (an edit gives exactly 1 insertion and 1 deletion, with no spurious changes).
- **Version history** (File → Version history). A compressed snapshot is kept on every save; with AutoSave, at most one every 10 minutes. Identical saves are skipped, and up to 100 versions are kept per file, stored only on this computer. Each version has a text preview and can be restored (Ctrl+Z undoes the restore), opened as a copy, or compared with the current text.
- **Citations and bibliography** (References). Each document has its own list of sources: books, articles, websites and reports. In-text citations and the reference list are formatted in APA 7, MLA 9 or Chicago author-date. Changing the style or editing a source updates every citation and the bibliography. DOCX round trip uses Word's own model, CITATION fields plus `customXml` `b:Sources`, and LibreOffice renders our output correctly.
- **Mail merge** (Tools). Recipients come from CSV: quotes, embedded newlines, `,` `;` or tab delimiters, BOM. «Field» placeholders preview each recipient in place. Finish & merge creates one document with a copy per recipient, separated by page breaks. Fields round-trip as Word MERGEFIELDs.
- **Equations** (Insert → Equation, Alt+=). Equations are written in LaTeX with a palette and a live preview, rendered by KaTeX with MathML for screen readers, and exported to PDF as real text. In DOCX they become **native Word equations (OMML)**. **Word equations in opened files are now displayed and editable**: OMML is converted to LaTeX, and unedited equations are written back byte-for-byte. LibreOffice renders our OMML correctly: fractions, radicals, sums and integrals with limits, matrices, accents. In Markdown they are `$…$` and `$$…$$`.
- **Charts and shapes** (Insert). Column, bar, line and pie charts are built from pasted data. Eight shape types take fill, outline and text. Both are drawn as SVG and inserted as 3× resolution pictures that keep their data for double-click editing, with alt text generated from the data.
- **Cover pages** (Insert → Cover page): Classic, Color band and Minimal. They are filled in from the document properties and built from ordinary styles, so they round-trip.
- **Restrict editing** (Review → Protect): read only, comments only, or tracked changes only. A transaction filter enforces it and a banner shows it. DOCX round trip is `w:documentProtection`; LibreOffice opens it.
- **Accessibility checker** (Review → Accessibility). It checks:
  - images without alt text
  - skipped or empty headings
  - tables without a header row, and merged cells
  - low text contrast (WCAG ratio)
  - vague link text
  - runs of blank paragraphs
  - a missing title
  - long documents without headings

  One-click fixes cover alt text, header rows and the title.
- **AI writing assistant** (Tools → AI assistant, **optional and off by default**). It can improve, proofread, shorten, lengthen, change the tone of, or summarize the selection, or follow a custom instruction. It uses Anthropic's Claude API (Claude Opus 5.5, official SDK, streaming, server-side fallback on policy declines).
  - The main process refuses every request while the assistant is off.
  - Each request shows exactly the text that will be sent, and goes out only when the user clicks Send.
  - The API key is encrypted with the OS keychain (Electron `safeStorage`), or taken from `ANTHROPIC_API_KEY`.
  - The E2E test runs against a local mock of the API. It checks that nothing is sent while the assistant is off or before Send, and verifies the exact request.
- Menus now return focus to the document after an item is chosen, so the next keystroke types into the text instead of the menu button. This was a bug found while testing mail merge.

### Known limitations (M4)
- **Compare.** Formatting-only differences are not reported. Images and other objects that differ are shown in their revised state and counted, not marked.
- **Citations.** There is no year disambiguation (2020a/2020b), and one source per citation (Word's `\m` multi-source citations import with their text but link only the first source). The bibliography lists every source in the document. ODT and Markdown get citations as plain text, with a warning.
- **Equations.**
  - The LaTeX→OMML subset covers fractions, scripts, radicals, n-ary operators, delimiters, matrices and cases, accents, bars, functions, text and about 150 symbols. Other LaTeX (for example `align`, `\overbrace`) is saved to DOCX as linear text, and the dialog warns before that happens.
  - Word equations with constructs outside the reverse mapping stay preserved and unchanged, but not editable.
  - ODT gets the LaTeX as text.
- **Charts and shapes** are pictures in DOCX and ODT, not native Word or ODF charts or shapes, so they can't be edited as charts in Word. Charts and shapes from Word files are still preserved, not shown. There are no free-floating text boxes.
- **Mail merge.** The recipient list is not saved with the document; choose it again after reopening. Merging produces one combined document only, with no per-recipient files or e-mail.
- **Restrict editing has no password** (like Word's protection, it is not a security feature). Word password hashes on opened files are ignored, and ODT protection is not read or written.
- **AI assistant.** It supports Claude only, with no local-model provider. It works on the selection as plain text: the replacement keeps paragraphs but not inline formatting, and a tracked-changes document records the replacement as a change.

## Milestone 5 ⏳

- **M5:** Packaging and signing, accessibility audit (axe), compatibility regression corpus, crash-recovery tests, release docs.

## Next recommended tasks

1. Milestone 5: build and smoke-test the installers (AppImage/deb/rpm here; NSIS/dmg need their platforms), including OCR from inside the packaged asar. Add axe-core checks to E2E, a corpus-based compatibility regression suite and release docs.
2. Per-section page setup in the layout engine (displayed landscape sections).
3. PDF: text layer on rotated pages, moving and resizing annotations, a warning before editing digitally signed files.
4. Native DOCX charts (`c:chartSpace`) so charts stay editable in Word.
