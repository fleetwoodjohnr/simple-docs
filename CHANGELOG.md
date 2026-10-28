# Changelog

## Unreleased

- **File previews.** Saved DOCX and ODT files carry a picture of page 1, so the desktop, file managers, Finder and Word show the page instead of a generic icon.
- **Updates from GitHub.** Simple Docs checks once a day whether a newer version has been released (Settings → Updates turns this off; *Check now* works any time). Nothing downloads until you click Install; the download is checked against the release's checksum, and Restart installs it. On Linux the rpm or deb update asks for your admin password. On macOS the download page opens instead, because unsigned apps can't update themselves.
- **New application icon.** A white page with a text cursor on an indigo tile, drawn to Apple's icon grid on macOS. The title bar logo matches it.
- **Word charts and shapes.** Charts and shapes are saved to DOCX as native Word charts (with their data in an embedded workbook, so Word's *Edit Data* works) and native Word shapes, not pictures. Charts and plainly coloured shapes in Word and LibreOffice files open as editable drawings, and go back unchanged unless edited.
- **Mail merge.** The recipient list is saved with the document (DOCX) and can be removed from the ribbon.
- **PDF.**
  - Rotated pages get a text layer: select, highlight, underline, strike and edit text there. New text, signatures and OCR text are placed upright.
  - Form fields created in Simple Docs now show their values in other PDF viewers.
- **Packages and CI.**
  - deb and rpm packages, with every library they need declared (checked by installing into clean Ubuntu 22.04/24.04 and Fedora 44).
  - A GitHub Actions workflow builds and tests Windows, macOS and Linux installers and drafts releases, with the files the in-app updater reads. Installers are unsigned.
- **Fixes.**
  - Re-saving a DOCX written by Simple Docs produced duplicate relationship ids, which Word reports as a damaged file.
  - Replaced images and charts are no longer carried along on every save.
  - Markdown import kept SVG images as text.
  - ODT and Markdown exports turned charts into pictures without a warning.
  - CSV header detection miscounted delimiters inside quotes.

## 0.1.0 — 2026-10-27

The first complete build. What works, what is partial, and how it was tested: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). What each file format keeps: [COMPATIBILITY.md](COMPATIBILITY.md).

- **Editor.** Real pagination (the PDF has the same pages as the editor), Word-style formatting, styles, lists, tables, images, headers and footers, footnotes and endnotes, table of contents, find and replace, offline spelling, comments, tracked changes.
- **Formats.**
  - Own DOCX and ODT engines with passthrough of unsupported content.
  - Markdown, with a source view.
  - HTML and text.
  - RTF and DOC through an optional LibreOffice.
  - PDF export.
- **PDF workspace.**
  - Annotations and real editing of existing text.
  - True redaction.
  - Forms, page operations and OCR.
  - Password-protected files.
- **Professional features.**
  - Writing tools: citations and bibliography (APA, MLA, Chicago), equations (Word-compatible), charts and shapes, cover pages.
  - Review: compare documents, version history, restrict editing, accessibility checker.
  - Mail merge.
  - An optional AI writing assistant (off by default, consent per request).
- **Quality and safety.**
  - Atomic saves.
  - AutoSave and crash recovery, including after a renderer crash.
  - Strict Content-Security-Policy.
  - WCAG 2.2 AA checks (axe) on the main screens.
  - A compatibility regression corpus.
  - A Linux AppImage tested end to end.
