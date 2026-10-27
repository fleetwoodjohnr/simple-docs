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
| Table borders and styles | 🟡 | Written as a single-line grid with a styled header row |
| Floating tables | 🟡 | Placed inline |
| Inline images (PNG, JPEG, GIF, BMP, WebP) | ✅ | |
| Images with square/tight wrap | ✅ | Mapped to wrap left/right |
| Behind-text / in-front images | 🟡 | Shown inline (warned) |
| EMF/WMF/TIFF images | 🔒 | Preserved (not displayed) |
| Hyperlinks, external and internal anchors | ✅ | |
| Page breaks; section breaks | ✅ / 🟡 | A section break becomes a page break; the last section's page setup is used |
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
| Multiple columns | ❌ | Shown as one column (warned) |

Preserved XML is written back only when everything it references (relationship ids, footnotes or endnotes part) still exists. Otherwise, for example after pasting into another document, it falls back to its text with a warning.

## ODT, RTF, DOC (through LibreOffice, M1)

These are converted to DOCX by a locally installed LibreOffice and then go through the DOCX engine, so the DOCX table applies. Saving goes the other way, through LibreOffice. Legacy `.doc` can be opened but not saved. A native ODT adapter is planned for M2.

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

## PDF export

| Feature | Status |
|---|---|
| Page size, margins, page breaks identical to the editor | ✅ (asserted by tests) |
| Selectable/searchable text, embedded font subsets, working links, heading outline (bookmarks), tagged PDF | ✅ |
| Headers and footers, page numbers, footnotes | ✅ |
