import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { LINE_END, doc, launch, quit, settle, stubDialogs, tempDir, withEditor } from './helpers'

const pdfText = (file: string, page: number) => execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', file, '-']).toString()

test('headers, footers and page numbers appear on every page and in the PDF', async () => {
  const { app, page } = await launch()
  const pdf = path.join(tempDir(), 'hf.pdf')
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await page.keyboard.type('First page body')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.keyboard.type('Second page body')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.keyboard.type('Third page body')

    // Footer: Insert → Page number → "Page X of Y"
    await page.getByRole('tab', { name: 'Insert', exact: true }).click()
    await page.getByRole('button', { name: 'Page number' }).click()
    await page.getByRole('menuitem', { name: /Page X of Y/ }).click()
    await settle(page)

    // Header: double-click the top margin of page 1 and type
    await page.locator('[data-doc-scroll]:visible').evaluate((el) => (el.scrollTop = 0))
    await settle(page, 200)
    const sheet = page.locator('[data-doc-scroll]:visible .page-sheet').first()
    const box = (await sheet.boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 30)
    await expect(page.getByTestId('hf-toolbar')).toBeVisible()
    await page.keyboard.type('Confidential draft')
    await page.keyboard.press('Escape')
    await settle(page)

    const headers = page.locator('[data-doc-scroll]:visible .sd-hf')
    await expect(headers.filter({ hasText: 'Confidential draft' })).toHaveCount(3)
    await expect(headers.filter({ hasText: 'Page 2 of 3' })).toHaveCount(1)
    const footerPos = await headers.filter({ hasText: 'Page 1 of 3' }).evaluate((el) => {
      const s = el.closest('.page-sheet')!.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { fromTop: (r.top - s.top) / s.height, fromBottom: (s.bottom - r.bottom) / s.height }
    })
    expect(footerPos.fromTop).toBeGreaterThan(0.85)
    const headerPos = await headers.filter({ hasText: 'Confidential draft' }).first().evaluate((el) => (el.getBoundingClientRect().top - el.closest('.page-sheet')!.getBoundingClientRect().top) / el.closest('.page-sheet')!.getBoundingClientRect().height)
    expect(headerPos).toBeLessThan(0.1)

    await stubDialogs(app, { save: pdf })
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect.poll(() => existsSync(pdf) && statSync(pdf).size > 1000, { timeout: 15_000 }).toBe(true)
    for (const n of [1, 2, 3]) {
      const txt = pdfText(pdf, n)
      expect(txt).toContain('Confidential draft')
      expect(txt).toContain(`Page ${n} of 3`)
    }
    // the header lives in the document model, so undo removes it
    expect(await withEditor<string>(page, `(e) => JSON.stringify(e.state.doc.attrs.hf.header.default)`)).toContain('Confidential draft')
  } finally {
    await quit(app)
  }
})

test('table of contents uses live page numbers', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await withEditor(page, `(e) => {
      const lorem = { type: 'paragraph', content: [{ type: 'text', text: 'Body text for the chapter. '.repeat(40) }] }
      const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
      e.commands.setContent({ type: 'doc', attrs: e.state.doc.attrs, content: [
        { type: 'paragraph' },
        h(1, 'Alpha'), lorem, h(2, 'Alpha detail'), lorem, { type: 'pageBreak' },
        h(1, 'Beta'), lorem, { type: 'pageBreak' },
        h(1, 'Gamma'), lorem
      ] })
      e.commands.setTextSelection(1)
    }`)
    await settle(page, 600)
    await page.getByRole('tab', { name: 'References' }).click()
    await page.getByRole('button', { name: 'Table of contents' }).click()
    await settle(page, 1200)
    const entries = await withEditor<[string, string][]>(page, `(e) => { const out = []; e.state.doc.descendants(n => { if (n.type.name === 'tocEntry') out.push([n.textContent, n.attrs.page]) }); return out }`)
    const sheets = await page.locator('[data-doc-scroll]:visible .page-sheet').count()
    // headings land on pages per the editor's own layout
    const pageOf = await withEditor<Record<string, number>>(page, `(e) => {
      const st = e.state.plugins.map(p => p.getState(e.state)).find(s => s && Array.isArray(s.breaks))
      const out = {}
      e.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') out[n.textContent] = st.breaks.filter(b => b.pos <= pos).length + 1 })
      return out
    }`)
    expect(entries.map(([t]) => t)).toEqual(['Alpha', 'Alpha detail', 'Beta', 'Gamma'])
    for (const [t, p] of entries) expect(Number(p)).toBe(pageOf[t])
    expect(Number(entries.at(-1)![1])).toBeGreaterThan(2)
    expect(sheets).toBeGreaterThanOrEqual(3)
    await expect(page.locator('[data-doc-scroll]:visible .sd-toc')).toBeVisible()
  } finally {
    await quit(app)
  }
})

test('footnotes: insert, edit, reserve space on the reference page, export', async () => {
  const { app, page } = await launch()
  const pdf = path.join(tempDir(), 'notes.pdf')
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    // Fill most of page 1, then reference a note near the bottom.
    await withEditor(page, `(e) => {
      const p = { type: 'paragraph', content: [{ type: 'text', text: 'Filler sentence for the first page. '.repeat(30) }] }
      e.commands.setContent({ type: 'doc', attrs: e.state.doc.attrs, content: [p, p, p, { type: 'paragraph', content: [{ type: 'text', text: 'Claim needing a source' }] }] })
      e.commands.focus('end')
    }`)
    await settle(page, 500)
    // Slow frames (a busy machine): the note editor has focus before the next frame, so no typed key is lost.
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window)
      Object.assign(window, { sdRaf: raf, requestAnimationFrame: (f: FrameRequestCallback) => (setTimeout(() => raf(f), 200), 0) })
    })
    await page.keyboard.press('ControlOrMeta+Alt+f')
    await page.keyboard.type('Primary source, 2024.')
    await page.evaluate(() => Object.assign(window, { requestAnimationFrame: (window as unknown as { sdRaf: typeof requestAnimationFrame }).sdRaf }))
    await expect(page.getByTestId('note-editor')).toBeVisible()
    await page.keyboard.press('Escape')
    await settle(page, 600)

    const notes = page.locator('[data-doc-scroll]:visible .page-sheet .sd-notes')
    await expect(notes).toContainText('Primary source, 2024.')
    // the note sits on the same sheet as its reference
    const refPage = await page.locator('[data-doc-scroll]:visible .sd-note-ref').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return [...document.querySelectorAll('[data-doc-scroll]:not([hidden]) .page-sheet')].findIndex((s) => { const b = s.getBoundingClientRect(); return r.top >= b.top && r.top <= b.bottom })
    })
    const notePage = await notes.first().evaluate((el) => [...document.querySelectorAll('[data-doc-scroll]:not([hidden]) .page-sheet')].indexOf(el.closest('.page-sheet')!))
    expect(refPage).toBeGreaterThanOrEqual(0)
    expect(notePage).toBe(refPage)
    // text never overlaps the note area
    const overlap = await page.evaluate(() => {
      const area = document.querySelector('[data-doc-scroll]:not([hidden]) .page-sheet .sd-notes')!.getBoundingClientRect()
      return [...document.querySelectorAll('[data-doc-scroll]:not([hidden]) .sd-doc p')].some((p) => {
        const r = p.getBoundingClientRect()
        return !p.closest('.sd-notes') && r.bottom > area.top + 1 && r.top < area.bottom
      })
    })
    expect(overlap).toBe(false)

    await stubDialogs(app, { save: pdf })
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect.poll(() => existsSync(pdf) && statSync(pdf).size > 1000, { timeout: 15_000 }).toBe(true)
    expect(pdfText(pdf, refPage + 1)).toContain('Primary source, 2024.')
  } finally {
    await quit(app)
  }
})

test('comments: add, reply, resolve, survive a DOCX round trip', async () => {
  const { app, page } = await launch({ settings: { authorName: 'Test Reviewer' } })
  const file = path.join(tempDir(), 'comments.docx')
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await page.keyboard.type('The budget increased by forty percent.')
    await withEditor(page, `(e) => e.commands.setTextSelection({ from: 25, to: 38 })`)
    await page.keyboard.press('ControlOrMeta+Alt+m')
    const thread = page.getByTestId('comment-thread')
    await expect(thread).toHaveCount(1)
    await page.getByLabel('Comment text').fill('Source for this figure?')
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(thread).toContainText('Source for this figure?')
    await expect(thread).toContainText('Test Reviewer')
    await page.getByLabel('Reply').fill('Finance report, Q3.')
    await page.getByLabel('Reply').press('Enter')
    await expect(thread).toContainText('Finance report, Q3.')
    await expect(page.locator('[data-doc-scroll]:visible .sd-comment')).toHaveText('forty percent')

    await stubDialogs(app, { save: file })
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/)
    await page.keyboard.press('ControlOrMeta+w')
    await stubDialogs(app, { open: [file] })
    await page.keyboard.press('ControlOrMeta+o')
    await expect(page.getByTestId('ribbon')).toBeVisible()
    await page.evaluate(() => (window as never as { __sd: { set(s: object): void } }).__sd.set({ rightPanel: 'comments' }))
    await expect(thread).toContainText('Source for this figure?')
    await expect(thread).toContainText('Finance report, Q3.')
    await expect(page.locator('[data-doc-scroll]:visible .sd-comment')).toHaveText('forty percent')
    // resolve
    await thread.getByRole('button', { name: 'Resolve' }).click()
    expect(await withEditor<boolean>(page, `(e) => Object.values(e.state.doc.attrs.comments)[0].resolved`)).toBe(true)
  } finally {
    await quit(app)
  }
})

test('track changes: record, show, accept', async () => {
  const { app, page } = await launch({ settings: { authorName: 'Editor One' } })
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await page.keyboard.type('Draft sentence here.')
    await page.keyboard.press('ControlOrMeta+Shift+t')
    await expect(page.getByTestId('track-indicator')).toContainText('on')
    await page.keyboard.press(LINE_END)
    await page.keyboard.type(' Added later.')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft') // before "later."
    // Backspace over "Added " (inside our own insertion → really deleted? no: that's own insertion)
    await withEditor(page, `(e) => e.chain().focus().setTextSelection({ from: 7, to: 16 }).deleteSelection().run()`) // "sentence " (original text)
    const ins = page.locator('[data-doc-scroll]:visible ins.sd-ins')
    const del = page.locator('[data-doc-scroll]:visible del.sd-del')
    expect(await ins.allTextContents()).toEqual([' Added later.'])
    await expect(del).toHaveText('sentence ')
    await expect(del).toHaveAttribute('data-author', 'Editor One')
    // Final view hides deletions
    await page.evaluate(() => (window as never as { __sd: { runCommand(id: string): void } }).__sd.runCommand('review.markup'))
    await expect(del).toBeHidden()
    await page.evaluate(() => (window as never as { __sd: { runCommand(id: string): void } }).__sd.runCommand('review.markup'))
    await page.getByRole('tab', { name: 'Review' }).click()
    await page.getByRole('button', { name: 'Accept' }).click()
    await page.getByRole('menuitem', { name: 'Accept all changes' }).click()
    await settle(page)
    expect(await withEditor<string>(page, `(e) => e.getText()`)).toBe('Draft here. Added later.')
    await expect(ins).toHaveCount(0)
  } finally {
    await quit(app)
  }
})

test('spell checking: offline underline, suggestions, add to dictionary', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await page.keyboard.type('This sentense has a mispelled word and Zorblax.')
    const bad = page.locator('[data-doc-scroll]:visible .sd-misspelled')
    await expect.poll(async () => (await bad.allTextContents()).sort(), { timeout: 10_000 }).toEqual(['Zorblax', 'mispelled', 'sentense'])
    await bad.filter({ hasText: 'mispelled' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'misspelled', exact: true }).click()
    expect(await withEditor<string>(page, `(e) => e.getText()`)).toContain('a misspelled word')
    await bad.filter({ hasText: 'Zorblax' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Add “Zorblax” to dictionary/ }).click()
    await expect.poll(async () => (await bad.allTextContents()).sort(), { timeout: 10_000 }).toEqual(['sentense'])
    expect(await page.evaluate(() => (window as never as { __sd: { get(): { settings: { customWords: string[] } } } }).__sd.get().settings.customWords)).toContain('Zorblax')
  } finally {
    await quit(app)
  }
})

test('table header row repeats on continuation pages (screen and PDF)', async () => {
  const { app, page } = await launch()
  const pdf = path.join(tempDir(), 'table.pdf')
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await withEditor(page, `(e) => {
      const cell = (t, h) => ({ type: h ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
      const rows = [{ type: 'tableRow', content: [cell('Account', 1), cell('Balance', 1)] }]
      for (let i = 1; i <= 60; i++) rows.push({ type: 'tableRow', content: [cell('Row ' + i), cell(String(i * 100))] })
      e.commands.setContent({ type: 'doc', attrs: e.state.doc.attrs, content: [{ type: 'table', content: rows }, { type: 'paragraph' }] })
    }`)
    await settle(page, 1000)
    const repeats = page.locator('[data-doc-scroll]:visible tr[data-pg-repeat]')
    expect(await repeats.count()).toBeGreaterThanOrEqual(1)
    await expect(repeats.first()).toContainText('Account')
    await stubDialogs(app, { save: pdf })
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect.poll(() => existsSync(pdf) && statSync(pdf).size > 1000, { timeout: 15_000 }).toBe(true)
    expect(pdfText(pdf, 2)).toContain('Account')
    expect(pdfText(pdf, 2)).toContain('Balance')
    // rows are not duplicated or lost across the page boundary
    const all = pdfText(pdf, 1) + pdfText(pdf, 2) + (existsSync(pdf) ? execFileSync('pdftotext', [pdf, '-']).toString() : '')
    for (const n of [1, 30, 60]) expect(all).toContain(`Row ${n}`)
  } finally {
    await quit(app)
  }
})

test('modifying a style restyles every paragraph that uses it', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await withEditor(page, `(e) => e.commands.setContent({ type: 'doc', attrs: e.state.doc.attrs, content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'First heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Second heading' }] }
    ] })`)
    await withEditor(page, `(e) => e.commands.setTextSelection(3)`)
    await page.evaluate(() => (window as never as { __sd: { runCommand(id: string): void } }).__sd.runCommand('style.modify'))
    await page.getByRole('dialog').getByLabel('Font size').fill('30')
    await page.getByTestId('style-save').click()
    const sizes = await page.locator('[data-doc-scroll]:visible .doc-host h1').evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize))
    expect(sizes).toEqual(['40px', '40px'])
    // undo reverts the style change
    await page.keyboard.press('ControlOrMeta+z')
    const after = await page.locator('[data-doc-scroll]:visible .doc-host h1').first().evaluate((el) => getComputedStyle(el).fontSize)
    expect(after).not.toBe('40px')
  } finally {
    await quit(app)
  }
})
