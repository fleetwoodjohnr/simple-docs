# Simple Docs

A fast, modern, offline word processor for Windows, macOS and Linux. It lays text out on real pages, round-trips DOCX with its own OOXML engine, exports PDF from the same layout you see, and edits Markdown both visually and as source.

> Status: Milestones 1–3 are complete, which includes the PDF workspace. For what works today, what is partial, and what is next, see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). [COMPATIBILITY.md](COMPATIBILITY.md) shows, per file format, which elements are kept.

## Quick start

```bash
npm install                 # Node 24+; Electron downloads its binary on first run
npm run dev                 # development (hot reload)
npm run build && npm start  # production build
```

| Script | What it does |
|---|---|
| `npm run typecheck` | Strict TypeScript for main, preload and renderer |
| `npm test` | Unit tests (vitest): pagination algorithm, DOCX round trip, third-party DOCX fixture, Markdown/HTML/TXT |
| `npm run e2e` | Build, then Playwright drives the real Electron app (acceptance tests, ODT/RTF bridge, 240-page performance) |
| `npm run e2e:headless` | Same, under `xvfb-run` (Linux CI / no display) |
| `npm run fixtures` | Regenerate `tests/fixtures/complex.{docx,odt,rtf,pdf}`, `protected.pdf` and `scanned.pdf` from `tests/fixtures/src/*.fodt` (LibreOffice, poppler, ImageMagick) |
| `npm run dist` | Build installers with electron-builder (AppImage/deb/rpm, NSIS, dmg) |

### Optional: LibreOffice

DOCX, **ODT**, Markdown, HTML, plain text and PDF export need nothing extra (DOCX and ODT use built-in engines). **RTF and legacy `.doc`** are converted through a locally installed LibreOffice (`soffice`). The app finds LibreOffice on `PATH` and in the standard install locations, and runs it headless with an isolated temporary profile. LibreOffice is not bundled, because it would add more than 300 MB. When it is missing, the app says so plainly when you open one of those formats.

## Architecture

```
src/main/       Electron main: window, secure IPC (validated, granted-paths only), atomic saves,
                settings/recents/recovery store, printToPDF/print, LibreOffice bridge
src/preload/    contextBridge API (typed in src/shared/ipc-types.ts); no raw ipcRenderer exposure
src/editor/     Tiptap/ProseMirror schema + extensions, document model (page setup, named styles),
                list numbering, find/replace, templates
src/layout/     Pagination engine: breaks.ts (pure algorithm) + plugin.ts (DOM measurement → spacer decorations)
src/formats/    Pure format adapters (bytes ⇄ editor JSON + warnings): docx/ (own OOXML reader/writer),
                odt/ (own ODF reader/writer), markdown, html, text, registry (incl. LibreOffice bridge)
src/export/     Print/PDF: slices the paginated DOM into fixed-size pages
src/pdf/        PDF engine on PDFium WASM: render, text runs, text editing, redaction, annotations, forms, pages
src/main/ocr.ts Offline OCR (tesseract.js, bundled English model) on a worker thread
src/renderer/   React UI: title bar, ribbon, panels, dashboard, dialogs, command registry, state;
                pdf/ = PDF workspace (PDFium runs in a Web Worker)
tests/          unit/ (vitest) · e2e/ (Playwright + Electron) · fixtures/
```

### Key decisions

- **Real pagination, with a clean document model.** Pages are a layout result and never appear as nodes in the document. The layout engine measures every line box, chooses page breaks with widow/orphan control, keep-with-next, keep-lines-together and page-break-before, and splits paragraphs between lines and tables between rows. It then inserts spacer decorations so the content physically flows onto the next sheet. PDF export and printing slice that same layout, so the PDF has the same pages as the editor, and the tests assert it.
- **Own DOCX engine.** DOCX-to-HTML converters intentionally discard formatting. Ours maps styles (including their basedOn chains), numbering, tables (merges, shading, widths), images, links, page setup and metadata into the editor. Anything it can't edit yet — headers/footers, footnotes, charts, shapes, equations, OLE objects — it keeps as raw XML plus the package parts that XML references, and writes it all back on save. It is never discarded silently.
- **Offline and private.** No network access, no account, no telemetry. The only exception is that links you open are handed to your browser.
- **Real PDF editing.** PDFs are edited through PDFium. Existing text is changed in the page's content stream, not covered with an overlay. Redaction removes the content, and OCR adds a real invisible text layer. The limits, such as no reflow and font substitution, are listed in the docs.
- **Security.** `contextIsolation` and `sandbox` are on and `nodeIntegration` is off. The packaged renderer runs under a strict Content-Security-Policy: no inline scripts and no `eval`. Navigation and new windows are blocked. The main process reads or writes only files you granted through a dialog, recents, drag-and-drop or the command line. Pasted and imported HTML is sanitized and parsed through the schema.

## Third-party licenses

All runtime dependencies are permissively licensed.

| Component | License |
|---|---|
| Electron, React, Tiptap/ProseMirror, fflate, @xmldom/xmldom, markdown-it, CodeMirror, Radix UI, zustand, Tailwind CSS | MIT |
| lucide-react | ISC |
| DOMPurify | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) |
| Inter (UI font) | SIL OFL 1.1 |
| Carlito, Liberation Sans/Serif/Mono (bundled metric-compatible document fonts) | SIL OFL 1.1 |
| Caladea (bundled) | Apache-2.0 |
| PDFium via `@embedpdf/pdfium` (WASM build) | BSD-3-Clause (PDFium), MIT (package) |
| tesseract.js, tesseract.js-core | Apache-2.0 |
| English OCR model (`@tesseract.js-data/eng`, from tessdata) | Apache-2.0 (model), MIT (package) |
| nspell | MIT |
| dictionary-en, dictionary-en-gb (Hunspell dictionaries) | MIT AND BSD |
| LibreOffice (optional, not bundled) | MPL-2.0 |

No commercial SDK is used. MuPDF was ruled out as the PDF engine because it is AGPL.
