import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { doc, launch, quit, settle, stubDialogs, tempDir, withEditor } from './helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFTEMNQkAJ/sA4ZbqDsgAAAAASUVORK5CYII='

type J = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string }[]; content?: J[] }
const all = (n: J, pred: (x: J) => boolean, out: J[] = []): J[] => {
  if (pred(n)) out.push(n)
  n.content?.forEach((c) => all(c, pred, out))
  return out
}
const pdfPages = (file: string) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())![1])
const pdfText = (file: string, page?: number) => execFileSync('pdftotext', [...(page ? ['-f', String(page), '-l', String(page)] : []), '-layout', file, '-']).toString()

test('acceptance 1–11: build a document, save DOCX, reopen, export PDF', async () => {
  const { app, page } = await launch()
  const dir = tempDir()
  const docxPath = path.join(dir, 'review.docx')
  const pdfPath = path.join(dir, 'review.pdf')
  try {
    await page.getByTestId('new-doc').click()
    const ed = doc(page)
    await ed.click()

    // 1–2. formatted paragraphs, headings, nested bullet list
    await page.keyboard.type('Annual Review')
    await page.keyboard.press('Control+Alt+1')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('This paragraph has ')
    await page.keyboard.press('Control+b')
    await page.keyboard.type('bold')
    await page.keyboard.press('Control+b')
    await page.keyboard.type(' and ')
    await page.keyboard.press('Control+i')
    await page.keyboard.type('italic')
    await page.keyboard.press('Control+i')
    await page.keyboard.type(' text.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Highlights')
    await page.keyboard.press('Control+Alt+2')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- First item')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Nested item')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type('Second item')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // 3. table with header and shading
    await page.evaluate(() => (window as never as { __sd: { runCommand(id: string): void } }).__sd.runCommand('insert.table'))
    await page.keyboard.type('Region')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Score')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Trend')
    await page.keyboard.press('Tab')
    await page.keyboard.type('North')
    await withEditor(page, `(e) => e.chain().focus().setCellAttribute('background', '#e8f0fe').run()`)
    // leave the table
    await withEditor(page, `(e) => { e.commands.focus('end') }`)

    // 4. image
    await withEditor(page, `(e) => e.chain().focus('end').insertContent([{ type: 'paragraph', content: [{ type: 'image', attrs: { src: '${PNG}', alt: 'Chart' } }] }]).run()`)
    await withEditor(page, `(e) => e.commands.focus('end')`)

    // 5. page break + second page content
    await page.keyboard.press('Control+Enter')
    await page.keyboard.type('Second page content')

    // 6. margins → Narrow via the ribbon
    await page.getByRole('tab', { name: 'Layout' }).click()
    await page.getByRole('button', { name: 'Margins' }).click()
    await page.getByRole('menuitem', { name: /Narrow/ }).click()
    await settle(page, 600)
    const layoutPages = await withEditor<number>(page, `(e) => document.querySelectorAll('[data-doc-scroll]:not([hidden]) .page-sheet').length`)
    expect(layoutPages).toBe(2)

    // 7. save as DOCX
    await stubDialogs(app, { save: docxPath })
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 10_000 })
    expect(existsSync(docxPath)).toBe(true)

    // 10–11. export PDF and check pagination parity
    await stubDialogs(app, { save: pdfPath })
    await page.keyboard.press('Control+Shift+e')
    await expect.poll(() => existsSync(pdfPath) && statSync(pdfPath).size > 1000, { timeout: 15_000 }).toBe(true)
    expect(pdfPages(pdfPath)).toBe(layoutPages)
    expect(pdfText(pdfPath, 1)).toContain('Annual Review')
    expect(pdfText(pdfPath, 1)).toContain('Nested item')
    expect(pdfText(pdfPath, 2)).toContain('Second page content')
    expect(pdfText(pdfPath, 1)).not.toContain('Second page content')

    // 8. close and reopen
    await page.keyboard.press('Control+w')
    await expect(page.getByTestId('dashboard')).toBeVisible()
    await stubDialogs(app, { open: [docxPath] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('ribbon')).toBeVisible()
    await settle(page)

    // 9. content and formatting survived the round trip
    const json = await withEditor<J>(page, `(e) => e.getJSON()`)
    expect(all(json, (n) => n.type === 'heading').map((h) => [h.attrs!.level, h.content?.[0]?.text])).toEqual([
      [1, 'Annual Review'],
      [2, 'Highlights']
    ])
    expect(all(json, (n) => n.text === 'bold')[0].marks!.map((m) => m.type)).toEqual(['bold'])
    expect(all(json, (n) => n.text === 'italic')[0].marks!.map((m) => m.type)).toEqual(['italic'])
    expect(all(json, (n) => n.type === 'bulletList')).toHaveLength(2)
    const table = all(json, (n) => n.type === 'table')[0]
    expect(table.content![0].content!.map((c) => c.content![0].content?.[0]?.text)).toEqual(['Region', 'Score', 'Trend'])
    expect(table.content![1].content![0].attrs!.background).toBe('#e8f0fe')
    expect(all(json, (n) => n.type === 'image')[0].attrs!.alt).toBe('Chart')
    expect(all(json, (n) => n.type === 'pageBreak')).toHaveLength(1)
    expect((json.attrs!.page as { margins: { left: number } }).margins.left).toBe(36)
    expect(await page.locator('[data-doc-scroll]:visible .page-sheet').count()).toBe(2)
  } finally {
    await quit(app)
  }
})

test('acceptance 14: Markdown import and export', async () => {
  const dir = tempDir()
  const mdIn = path.join(dir, 'notes.md')
  const mdOut = path.join(dir, 'notes-out.md')
  writeFileSync(mdIn, '# Project Notes\n\nSome **bold** and *italic* and `code`.\n\n- one\n  - nested\n- two\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n\n```js\nconst x = 1\n```\n')
  const { app, page } = await launch()
  try {
    await stubDialogs(app, { open: [mdIn] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('ribbon')).toBeVisible()
    const json = await withEditor<J>(page, `(e) => e.getJSON()`)
    expect(all(json, (n) => n.type === 'heading')[0].content![0].text).toBe('Project Notes')
    expect(all(json, (n) => n.type === 'taskItem').map((t) => t.attrs!.checked)).toEqual([true, false])
    expect(all(json, (n) => n.type === 'table')).toHaveLength(1)
    expect(all(json, (n) => n.type === 'codeBlock')).toHaveLength(1)
    await stubDialogs(app, { save: mdOut })
    await page.keyboard.press('Control+Shift+s')
    await expect.poll(() => existsSync(mdOut)).toBe(true)
    const out = readFileSync(mdOut, 'utf8')
    for (const s of ['# Project Notes', '**bold**', '*italic*', '`code`', '- one', '  - nested', '1. first', '- [x] done', '- [ ] todo', '| A | B |', '> quoted', '```js']) expect(out).toContain(s)
  } finally {
    await quit(app)
  }
})

test('acceptance 17 & 19: undo/redo and keyboard shortcuts', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('ribbon')).toBeVisible()
    await doc(page).click()
    await page.keyboard.type('alpha beta gamma')
    await settle(page, 700)
    await page.keyboard.press('Control+z')
    expect(await withEditor<string>(page, `(e) => e.getText()`)).toBe('')
    await page.keyboard.press('Control+y')
    expect(await withEditor<string>(page, `(e) => e.getText()`)).toBe('alpha beta gamma')

    // shortcuts
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+u')
    expect(await withEditor<boolean>(page, `(e) => e.isActive('underline')`)).toBe(true)
    await page.keyboard.press('Control+e')
    expect(await withEditor<string>(page, `(e) => e.state.doc.firstChild.attrs.align`)).toBe('center')
    await page.keyboard.press('End')
    await page.keyboard.press('Control+Enter')
    expect(await withEditor<number>(page, `(e) => { let n = 0; e.state.doc.descendants(x => { if (x.type.name === 'pageBreak') n++ }); return n }`)).toBe(1)
    await page.keyboard.press('Control+f')
    await expect(page.getByTestId('find-bar')).toBeVisible()
    await page.getByTestId('find-bar').getByLabel('Find', { exact: true }).fill('beta')
    await expect(page.getByTestId('find-bar')).toContainText('1/1')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+n')
    expect(await page.evaluate(() => (window as never as { __sd: { get(): { tabs: unknown[] } } }).__sd.get().tabs.length)).toBe(2)
  } finally {
    await quit(app)
  }
})

test('acceptance 18: autosave and crash recovery', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'auto.docx')
  const userData = tempDir('sd-profile-')
  let { app, page } = await launch({ userData, settings: { autosave: true, autosaveIntervalSec: 1, recoveryIntervalSec: 1 } })
  try {
    // AutoSave writes the file after an edit
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('First version')
    await stubDialogs(app, { save: file })
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
    await page.keyboard.type(' with autosaved words')
    await expect.poll(() => strFromU8(unzipSync(readFileSync(file))['word/document.xml']).includes('autosaved words'), { timeout: 10_000 }).toBe(true)

    // Crash recovery: unsaved edits survive a hard kill
    await page.keyboard.press('Control+n')
    await doc(page).click()
    await page.keyboard.type('Unsaved recovery text')
    await expect.poll(() => (existsSync(path.join(userData, 'recovery')) ? readdirSync(path.join(userData, 'recovery')).length : 0), { timeout: 10_000 }).toBeGreaterThan(0)
    app.process().kill('SIGKILL')
    ;({ app, page } = await launch({ userData }))
    await expect(page.getByTestId('recovery')).toBeVisible()
    await page.getByRole('button', { name: 'Restore' }).first().click()
    await expect(doc(page)).toContainText('Unsaved recovery text')
  } finally {
    await quit(app)
  }
})
