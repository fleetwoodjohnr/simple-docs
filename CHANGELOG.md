# Changelog

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
