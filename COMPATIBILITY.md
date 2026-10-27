# Compatibility matrix

Legend:

- ✅ **Full**: editable, and it round-trips.
- 🟡 **Partial**: editable, but some properties are approximated or dropped, with a warning.
- 🔒 **Preserved**: kept verbatim and written back on save to the same format, but not editable yet.
- ❌ **Unsupported**: not kept, and the compatibility report says so.

On open, every adapter produces a warning list (the ⚠ badge in the title bar). Saving to a format that cannot hold something shows a confirmation that lists what will change.

## DOCX (own OOXML engine)

| Element | Status | Notes |
|---|---|---|
| Paragraph text, runs, tabs, line breaks, non-breaking/soft hyphens, symbols | ✅ | |
| Bold, italic, underline, strike, double strike, sub/superscript, caps, small caps | ✅ | |
| Font family, size, color, highlight (named and shading), character spacing | ✅ | Theme fonts resolve through `theme1.xml` |
| Character styles | 🟡 | Flattened into direct formatting on import |
| Paragraph styles with basedOn inheritance, docDefaults | ✅ | Built-in names are normalized across languages using `w:name` |
| Headings 1–9, Title, Subtitle, Quote, Caption | ✅ | |
| Alignment, spacing before/after, indents (left, right, first line, hanging), keep next, keep lines, page break before, shading, RTL | ✅ | |
| Line spacing "auto" (multiple) | ✅ | |
| Line spacing "exact" / "at least" | 🟡 | Approximated as a multiple |
| Paragraph borders, custom tab stops | ❌ | Warned |
| Bulleted, numbered and multilevel lists, start values, continued numbering | ✅ | Nested lists are rebuilt from flat `numPr` |
| Exotic number formats (e.g. ordinal text) | 🟡 | Shown as decimal |
| Numbered headings | 🟡 | Headings keep their style; the number is not shown (warned) |
| Checklists | ✅ | Written as `w14:checkbox` content controls |
| Tables: grid widths, header rows, colspan, rowspan (vMerge), cell shading, vertical alignment | ✅ | |
| Nested tables | ✅ | |
| Table styles (grid / no borders / horizontal lines / striped) | ✅ | Other Word table styles are shown as a grid |
| Floating tables | 🟡 | Placed inline |
| Inline images (PNG, JPEG, GIF, BMP, WebP) | ✅ | |
| Images with square/tight wrap | ✅ | Mapped to wrap left/right |
| Behind-text / in-front images | 🟡 | Shown inline (warned) |
| EMF/WMF/TIFF images | 🔒 | Preserved (not displayed) |
| Hyperlinks, external and internal anchors | ✅ | |
| Page breaks | ✅ | |
| Section breaks (with orientation, size, columns, numbering) | 🟡 | Kept and written back verbatim; the editor shows all sections with the document's page setup |
| Page size, orientation, margins, header/footer distance, gutter | ✅ | |
| Headers and footers (default / first / even), PAGE / NUMPAGES / DATE / TITLE / AUTHOR fields, page-number format | ✅ | Other fields in headers keep their last result text |
| Footnotes and endnotes | ✅ | Custom note separators are regenerated |
| Charts, SmartArt, shapes, text boxes, VML, OLE objects, equations (OMML) | 🔒 | Raw XML and referenced parts written back |
| Content controls (SDT) | 🟡 | Content kept; the control wrapper is dropped (checkbox controls and the TOC control are kept) |
| Fields (simple and complex) | 🟡 | The current result text is kept; the field code is dropped (warned) |
| Comments with replies and resolved state | ✅ | Via `comments.xml` + `commentsExtended.xml` |
| Tracked insertions/deletions | ✅ | Tracked formatting changes from Word are shown as accepted (noted) |
| Bookmarks | ❌ | Dropped silently (they have no visible content); M2 |
| Document properties (title, subject, author, keywords, description, dates) | ✅ | |
| Multiple columns | 🟡 | Kept on save; shown as one column (warned) |

Preserved XML is written back only when everything it references (relationship ids, footnotes or endnotes part) still exists. Otherwise, for example after pasting into another document, it falls back to its text with a warning.

## ODT (native engine — no LibreOffice needed)

| Element | Status | Notes |
|---|---|---|
| Paragraph and text formatting, named styles with inheritance, default style | ✅ | Fonts resolve through font-face declarations |
| Headings (outline levels), Title, Subtitle, Quotations | ✅ | |
| Bulleted / numbered / multilevel lists, start values, continued numbering | ✅ | Checklists are written as ☐/☒ prefixed list items (ODF has no checklist) |
| Tables: column widths, header rows, row/column spans, cell shading, vertical alignment | ✅ | Cell borders written as a single-line grid |
| Images (inline and wrapped left/right), alt text | ✅ | |
| Hyperlinks, footnotes, endnotes | ✅ | |
| Comments (replies and resolved via LibreOffice's `loext` extension) | ✅ | Point comments (no range) are listed but not highlighted |
| Headers/footers (default, left/even, first page), page number/count/date/title fields | ✅ | |
| Page size, orientation, margins, page color, page-number format | ✅ | ODF margins exclude the header; converted both ways |
| Table of contents | ✅ | Entries and page numbers kept; refresh in Simple Docs |
| Page breaks | ✅ | Written as break-before on the next paragraph |
| Tracked changes | 🟡 | Imported as accepted; saved as final text (warned) |
| Text boxes, drawings, other unknown elements | 🔒 | Preserved and written back to ODT; plain text in other formats |
| Sections / columns | ❌ | Content kept, section formatting dropped (warned) |
| Custom starting page number | ❌ | Not written (warned) |

## RTF, DOC (through LibreOffice)

These are converted to DOCX by a locally installed LibreOffice and then go through the DOCX engine, so the DOCX table applies. RTF saves go back through LibreOffice. Legacy `.doc` can be opened but not saved.

## Markdown

| Element | Import | Export |
|---|---|---|
| Headings, paragraphs, bold, italic, strike, inline code, links, images | ✅ | ✅ |
| Bulleted, ordered (with start) and nested lists, task lists, block quotes, fenced code, horizontal rules, GFM tables | ✅ | ✅ |
| Title style | — | Exported as `#` |
| Underline, sub/superscript, highlight, fonts, sizes, colors | — | ❌ warned |
| Alignment, spacing, indents, page setup | — | ❌ warned |
| Merged cells; lists inside cells | — | 🟡 split / flattened, warned |
| Page breaks, preserved content | — | ❌ warned |
| Raw HTML in the source | 🟡 shown as text | — |

Source mode shows the generated Markdown with syntax highlighting and a live preview. Edits sync back to the document.

## HTML

| Direction | Status |
|---|---|
| Import | Sanitized with DOMPurify, then parsed through the editor schema. Inline styles for alignment, spacing, indents, colors and fonts are recognized. Linked (non-embedded) images are not loaded, because the app is offline (warned). |
| Export | Standalone file with the document's styles inlined. |

## Plain text

Import detects the encoding: UTF-8, UTF-8/16 BOMs, and Windows-1252 as a fallback. Form feeds become page breaks. Export flattens lists to text markers and tables to tab-separated columns, with a warning.

## PDF workspace (opening and editing existing PDFs)

Engine: PDFium (WASM). Saving always writes a complete new file, so incremental-update history is not kept.

| Feature | Status |
|---|---|
| Viewing, search, copy text | ✅ |
| Highlight, underline, strike-through, sticky note, ink annotations (standard PDF annotations) | ✅ add, list and delete · ⚠️ existing annotations cannot be moved or edited |
| Editing existing text | ✅ line-level, written into the content stream · ⚠️ no reflow; a standard font is substituted when the embedded subset lacks a character, and it covers Latin-1 only |
| Add text, images, drawn signatures | ✅ · ⚠️ signatures are images, not certificate signatures |
| Redaction | ✅ removes text from the file (verified) · ⚠️ removal of images and vector graphics relies on PDFium and is not yet tested |
| Rotate, delete, insert, reorder, merge, extract, split, crop pages | ✅ · ⚠️ crop sets the CropBox and does not remove content |
| AcroForm text fields and checkboxes: fill, create | ✅ · ⚠️ radio, combo and list fields read-only; form JavaScript never runs |
| Metadata (title, author, subject, keywords) | ✅ |
| OCR of scanned pages into an invisible, searchable text layer | ✅ English, offline |
| Password-protected PDFs | ✅ opened with the password; saved with the same encryption · ⚠️ permission flags not enforced |
| Rotated pages | ✅ view, page operations · ⚠️ no text layer, so no selection, markup or text editing |
| Printing | ✅ each page at its own size · ⚠️ printed as 150 dpi images |
| Digital signatures (validation or signing) | ❌ not supported |

## PDF export

| Feature | Status |
|---|---|
| Page size, margins, page breaks identical to the editor | ✅ (asserted by tests) |
| Selectable/searchable text, embedded font subsets, working links, heading outline (bookmarks), tagged PDF | ✅ |
| Headers and footers, page numbers, footnotes | ✅ |
