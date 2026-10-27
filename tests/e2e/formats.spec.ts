import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { doc, launch, quit, settle, stubDialogs, tempDir, withEditor } from './helpers'

const fixtures = path.join(__dirname, '../fixtures')
const hasLibreOffice = ['/usr/bin/soffice', '/usr/bin/libreoffice'].some(existsSync)

test('acceptance 12–13: open an ODT, edit it and save it back (LibreOffice bridge)', async () => {
  test.skip(!hasLibreOffice, 'LibreOffice not installed')
  const dir = tempDir()
  const odt = path.join(dir, 'complex.odt')
  copyFileSync(path.join(fixtures, 'complex.odt'), odt)
  const { app, page } = await launch()
  try {
    await stubDialogs(app, { open: [odt] })
    await page.keyboard.press('Control+o')
    await expect(page.getByTestId('ribbon')).toBeVisible({ timeout: 30_000 })
    await expect(doc(page)).toContainText('Fixture Report')
    await expect(doc(page)).toContainText('Merged across')
    await withEditor(page, `(e) => e.chain().focus('end').insertContent(' Edited in Simple Docs.').run()`)
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 30_000 })
    const content = strFromU8(unzipSync(readFileSync(odt))['content.xml'])
    expect(content).toContain('Edited in Simple Docs.')
    expect(content).toContain('Introduction')
  } finally {
    await quit(app)
  }
})

test('RTF import through LibreOffice', async () => {
  test.skip(!hasLibreOffice, 'LibreOffice not installed')
  const { app, page } = await launch()
  try {
    await stubDialogs(app, { open: [path.join(fixtures, 'complex.rtf')] })
    await page.keyboard.press('Control+o')
    await expect(doc(page)).toContainText('Nested bullet', { timeout: 30_000 })
  } finally {
    await quit(app)
  }
})

test('performance: 300-page document', async () => {
  const { app, page } = await launch()
  try {
    await page.keyboard.press('Control+n')
    await doc(page).click()
    const para = 'Performance paragraph with enough words to wrap across a couple of lines on a standard Letter page so the paginator has real line boxes to measure. '
    await withEditor(page, `(e) => {
      const content = []
      for (let i = 0; i < 2400; i++) {
        if (i % 40 === 0) content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter ' + (i / 40 + 1) }] })
        content.push({ type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(para)}.repeat(1 + (i % 3)) }] })
        if (i % 120 === 0) content.push({ type: 'table', content: Array.from({ length: 8 }, (_, r) => ({ type: 'tableRow', content: [0, 1, 2, 3].map((c) => ({ type: r ? 'tableCell' : 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'R' + r + 'C' + c }] }] })) })) })
      }
      e.commands.setContent({ type: 'doc', attrs: e.state.doc.attrs, content })
    }`)
    await expect.poll(async () => page.locator('[data-doc-scroll]:visible .page-sheet').count(), { timeout: 60_000 }).toBeGreaterThan(200)
    await settle(page, 1500)
    const pages = await page.locator('[data-doc-scroll]:visible .page-sheet').count()
    const pass = await withEditor<number>(page, `(e) => { const t = performance.now(); e.commands.repaginate(); return performance.now() - t }`)
    // keystroke → next frame latency in the middle of the document
    await withEditor(page, `(e) => { e.commands.setTextSelection(Math.floor(e.state.doc.content.size / 2)); e.commands.focus() }`)
    const latencies: number[] = []
    for (let i = 0; i < 15; i++) {
      latencies.push(
        await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const t = performance.now()
              const sd = (window as never as { __sd: { editors: Map<string, { commands: { insertContent(s: string): void } }>; get(): { active: string } } }).__sd
              sd.editors.get(sd.get().active)!.commands.insertContent('x')
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t)))
            })
        )
      )
    }
    latencies.sort((a, b) => a - b)
    const median = latencies[Math.floor(latencies.length / 2)]
    console.log(`PERF pages=${pages} fullPagination=${pass.toFixed(1)}ms keystrokeMedian=${median.toFixed(1)}ms keystrokeMax=${latencies.at(-1)!.toFixed(1)}ms`)
    expect(pages).toBeGreaterThan(200)
    expect(pass).toBeLessThan(1500)
  } finally {
    await quit(app)
  }
})
