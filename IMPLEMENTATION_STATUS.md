# Implementation status

_Last updated: 2026-10-28 · Milestones 1–5 complete, plus the follow-up work in [After 0.1.0](#after-010-released-as-020) · Windows/macOS: built and tested in CI · version 0.2.0._

"Done" means implemented **and** covered by a passing automated test or a manual check recorded below. A button existing in the UI does not count.

## Test results (current)

| Suite | Result |
|---|---|
| `npm run typecheck` (strict, main + renderer) | ✅ clean |
| `npm test` (vitest) | ✅ 194 / 194 (incl. 35 golden round trips in the compatibility corpus + 2 LibreOffice re-save checks) |
| `npm run e2e:headless` (Playwright + Electron) | ✅ 33 / 33 + 2 packaged-only (every test also fails on any Content-Security-Policy violation) |
| Same E2E suite against the **packaged** app (`SD_PACKAGED=release/linux-unpacked/simple-docs`) | ✅ 34 / 34 |
| AppImage smoke test (DOCX, spelling, equations, PDF export, PDFium, OCR) | ✅ |
| deb: installed in clean Ubuntu 22.04, 24.04 and 26.04 containers, every shared library resolved (CI, every push); smoke test on its binary | ✅ |
| rpm: installed in a Fedora 44 container, every shared library resolved (CI, every push) | ✅ |
| Windows (NSIS) and macOS (dmg, zip): build + unit + E2E + packaged E2E in GitHub Actions | ✅ green in GitHub Actions |
| axe-core WCAG 2.2 AA (dashboard, editor + all ribbon tabs, settings, PDF workspace; light and dark) | ✅ 0 violations |
| Independent consumer: our DOCX → LibreOffice → PDF | ✅ (in `docx.test.ts`; native charts in `docx-drawing.test.ts`: their labels come out as PDF text, and the embedded workbook reads back as the chart data) |
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
- **Rotated pages: no new form fields.** Selection, markup, text editing, new text, signatures and OCR work on rotated pages ([After 0.1.0](#after-010-released-as-020)). Form fields can't be added there: this PDFium build can't set a widget's rotation (`/MK /R`), so the value would read sideways in other viewers. The Field tool says so. Text drawn at angles other than quarter turns is not grouped into lines.
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
- **Mail merge** (Tools). Recipients come from CSV: quotes, embedded newlines, `,` `;` or tab delimiters, BOM. «Field» placeholders preview each recipient in place. Finish & merge creates one document with a copy per recipient, separated by page breaks. Fields round-trip as Word MERGEFIELDs. The recipient list is saved with the document ([After 0.1.0](#after-010-released-as-020)).
- **Equations** (Insert → Equation, Alt+=). Equations are written in LaTeX with a palette and a live preview, rendered by KaTeX with MathML for screen readers, and exported to PDF as real text. In DOCX they become **native Word equations (OMML)**. **Word equations in opened files are now displayed and editable**: OMML is converted to LaTeX, and unedited equations are written back byte-for-byte. LibreOffice renders our OMML correctly: fractions, radicals, sums and integrals with limits, matrices, accents. In Markdown they are `$…$` and `$$…$$`.
- **Charts and shapes** (Insert). Column, bar, line and pie charts are built from pasted data. Eight shape types take fill, outline and text. In the editor both are 3× resolution pictures that keep their data for double-click editing, with alt text generated from the data. In DOCX they are **native Word charts and shapes** (see [After 0.1.0](#after-010-released-as-020)).
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
- **Charts and shapes.**
  - Editable charts are clustered column and bar, line and pie. Other Word charts (stacked, scatter, area, 3-D, combo, and Word 2016 chart types) stay preserved and are written back unchanged, but the editor shows a placeholder, not the chart.
  - Shapes from files are editable when they use one of the eight preset outlines with explicit colours and plain text. Theme-styled shapes, gradients and effects stay preserved, shown as a placeholder.
  - A chart from Word that you edit is saved with Simple Docs' styling: Word's fonts, colours and axis formats are replaced. Unedited ones go back byte for byte.
  - ODT and Markdown get pictures, with a warning. There are no free-floating text boxes.
- **Mail merge.** The recipient list travels in DOCX only (ODT, Markdown, HTML and text warn). Word ignores it, because Word's own mail merge links to an external data file, which isn't written. Merging produces one combined document only, with no per-recipient files or e-mail.
- **Restrict editing has no password** (like Word's protection, it is not a security feature). Word password hashes on opened files are ignored, and ODT protection is not read or written.
- **AI assistant.** It supports Claude only, with no local-model provider. It works on the selection as plain text: the replacement keeps paragraphs but not inline formatting, and a tracked-changes document records the replacement as a change.

## Milestone 5 — Release readiness ✅ (limits listed below)

### Done
- **Packaging (Linux, verified).**
  - A 149 MB AppImage with app icon and desktop entry. The whole E2E suite passes against the packaged app.
  - The packaged smoke test found that OCR hung in installed builds. The worker thread starts from `app.asar.unpacked` and couldn't resolve its dependencies. The full dependency closure is now unpacked, and OCR start-up fails with a message after 30 seconds instead of hanging.
  - Unused OCR browser builds are excluded (−20 MB).
- **Accessibility audit.** axe-core WCAG 2.2 AA checks run in E2E on every main screen, in both themes. Fixes:
  - The tab strips now follow the tablist pattern; the document tabs no longer contain a nested close button. Close a tab with Delete or Ctrl+W.
  - The Home tab has a name.
  - Secondary text and accent text now reach at least 4.5:1, via a new `--accent-ink` token derived from the user's accent colour.
  - Ribbon controls' accessible names include their visible text.
  - Targets are at least 24 px, and the PDF page area is keyboard-focusable.
- **Compatibility regression corpus.** Every template plus a "kitchen sink" document (formatting, comments, tracked changes, nested and numbered lists, merged cells, footnotes, equations, citations, merge fields, page breaks) is round-tripped through DOCX, ODT, Markdown, HTML and text. The results are compared with reviewed golden files in `tests/unit/__corpus__/`, and our DOCX and ODT are also re-saved by LibreOffice and read back. Bugs the corpus found:
  - Markdown footnotes were exported but not imported.
  - Pasted or imported footnotes and tracked deletions were parsed as superscript and strikethrough (parse-rule priority).
  - Markdown export dropped comments without a warning.
  - HTML export reported no warnings while dropping comment threads, headers and footers, and the sources list.
- **Crash recovery.**
  - A crashed renderer now reloads and offers its recovery snapshot. This was previously a blank window; it's tested with a forced renderer crash.
  - Corrupt snapshots are skipped.
  - A failed save leaves the original file intact and no temp file behind; the directory is fsynced after the rename. Unit-tested, including concurrent saves.
  - Hard-kill recovery is covered by acceptance test 18.
- **Release documentation.** [RELEASE.md](RELEASE.md) is the build, test, smoke-test and publish checklist, and [CHANGELOG.md](CHANGELOG.md) records the changes.

### Not done / partial (M5)
- **Windows and macOS installers are tested in CI only** (the E2E suite against the packaged app). The by-hand checks in RELEASE.md §7 still apply before publishing. Builds are unsigned by decision.
- **Accessibility.** axe covers automated WCAG checks only. Screen-reader passes (NVDA, VoiceOver, Orca) and a keyboard-only walkthrough of every dialog are still to do.

## After 0.1.0 (released as 0.2.0)

The five open items from the 0.1.0 report, plus the bugs that came up while doing them.

### Done
- **Rotated PDF pages.**
  - The text layer is drawn turned with the page, so selection, highlight/underline/strike and text editing work at 90°, 180° and 270°.
  - New text, signatures and OCR text are placed upright as the page is displayed.
  - Lines group in their own text direction, so text set at a quarter turn (like text added to a rotated page) can be selected and edited too.
  - Tests: OCR of poppler's rendering reads text the app added to a rotated page, and the invisible OCR text lands over the drawn words (`ocr.test.ts`). An E2E test covers selecting, highlighting, editing and adding text on a rotated page and checks the saved file with `pdftotext`.
- **Mail-merge recipients saved with the document.**
  - The list is a document attribute, so it is undoable and kept by AutoSave, recovery and version history.
  - In DOCX it is a custom XML part (`urn:simple-docs:mail-merge:1`, CSV inside), and LibreOffice keeps it when re-saving.
  - The ribbon shows that the list is stored in the document, with a button to remove it.
  - E2E: choose recipients, save, close, reopen, preview and merge without the CSV.
- **Native Word charts and shapes.**
  - Charts are DrawingML `c:chartSpace` parts with cached data, Simple Docs' colours and an embedded one-sheet workbook, so Word's *Edit Data* works.
  - Shapes are Word 2010 shapes (`wps`) with preset outlines, colours and centred text, plus a picture fallback for older readers.
  - Charts from Word or LibreOffice, and shapes with explicit colours, open as editable drawings and are written back unchanged unless edited.
  - Tests: every chart and shape type round-trips. LibreOffice renders our charts as charts (title and labels come out as PDF text), reads the embedded workbook, and keeps both the chart and the shape when it re-saves our DOCX.
- **deb and rpm.**
  - Maintainer `fleetwoodjohnr@gmail.com`, homepage `https://github.com/fleetwoodjohnr/simple-docs`.
  - Built in a Fedora 44 container, because fpm needs `libcrypt.so.1` and `rpmbuild`, which the build host lacks (RELEASE.md).
  - Installing in clean containers found missing dependencies: `libgbm1` and ALSA for the deb, and ALSA, GBM and libsecret for the rpm. All are now declared.
- **Windows and macOS through CI.** `.github/workflows/ci.yml` runs on Linux, Windows and macOS:
  - typecheck, unit tests, E2E
  - installers (NSIS x64; dmg and zip for arm64 and x64; AppImage, deb, rpm)
  - the E2E suite again against each packaged app
  - uploads the installers; a `v*` tag drafts a GitHub release.

  Builds are unsigned by decision; macOS builds are signed ad hoc so Apple Silicon runs them. The tests were made portable for it: tools are found on PATH, shortcuts use ⌘ on macOS, line and document end use the macOS keys, and LF line endings are enforced.
- **File previews.** Saved DOCX and ODT files embed a 256 px PNG of page 1 (DOCX: `docProps/thumbnail.png` through the package thumbnail relationship; ODT: `Thumbnails/thumbnail.png`), which GNOME's thumbnailer, Finder (QuickLook) and Word use.
  - Only what is on screen can be captured, so page 1 is captured whenever it is visible: on open, at the idle recovery snapshot and on save. Scrolled away, the last capture is used; edits further down rarely change page 1.
  - The capture is clipped to the visible document area, so the ruler and status bar never show. The text cursor can.
  - Tests: both packages, GNOME's `gsf-office-thumbnailer` reads them (`thumbnail.test.ts`), and the E2E save checks the 256 px picture in the file.
- **Updates from GitHub Releases** (`src/main/updater.ts`, electron-updater 6.8.10).
  - Checked ~10 s after startup, at most once a day; Settings → Updates turns it off and has *Check now* (also a command, and the macOS app menu). The automatic check is silent unless there is an update.
  - Nothing downloads until Install. Downloads are verified against the sha512 in the release's `latest*.yml`. *Restart now* goes through the usual unsaved-documents check.
  - Windows (NSIS), AppImage, rpm and deb install in place (rpm/deb through `pkexec`). macOS opens the release page instead, because ad-hoc-signed apps can't apply updates.
  - Tests: a packaged E2E serves a 99.0.0 release from a local feed and checks the prompt, the verified download and the restart prompt. All other tests point the updater at a closed local port, so no test contacts GitHub.

### Bugs found and fixed on the way
- **Re-saving a DOCX written by Simple Docs duplicated relationship ids.** Word reports such files as damaged. Generated ids and part names now skip the original's, and carried parts that nothing references any more (a replaced image or chart) are dropped instead of piling up.
- **Form fields created in the PDF workspace showed their values only inside Simple Docs.** They had no default appearance, so other viewers drew them empty. Checked by rendering with poppler and OCR.
- **Markdown re-import turned SVG images into literal text.** markdown-it rejects SVG data URLs; they are now accepted, and the HTML is still sanitized.
- **ODT and Markdown exports turned charts and shapes into pictures without a warning.**
- **CSV delimiter detection counted delimiters inside quoted header fields.**
- **A menu item chosen right after the menu opened could leave the menu stuck** (it kept CI red on every OS). Radix keeps a closing menu or dialog mounted until its exit animation ends, and took an open animation that had not started yet for one. The stuck menu trapped focus or closed the next menu as it opened. Closed surfaces now have no animation; the E2E helper `slowFrames` also delays CSS animations, which reproduces it.

### Still open
- **The updater's final install step** (installer, pkexec) runs for real only once a second updater-enabled release exists.
- **No code signing** (by decision), so SmartScreen and Gatekeeper warn.
- **Form fields can't be created on rotated PDF pages** (see the M3 limits).
- **ODT charts and shapes are pictures.**

## Next recommended tasks

1. Do screen-reader and keyboard-only passes.
2. Per-section page setup in the layout engine (displayed landscape sections).
3. PDF: moving and resizing annotations, a warning before editing digitally signed files, and form fields on rotated pages (needs writing the widget's `/MK` dictionary).
4. Native ODF charts, and signing once certificates exist.
