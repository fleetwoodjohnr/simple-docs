import { test, expect } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { doc, launch, quit } from './helpers'

/** A stand-in for the Claude API on localhost: records requests and streams a fixed reply (SSE). */
function mockClaude(reply: string[]) {
  const requests: { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      requests.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-opus-5-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } })
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      for (const t of reply) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })
      ev('content_block_stop', { index: 0 })
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
      ev('message_stop', {})
      res.end()
    })
  })
  return new Promise<{ url: string; requests: typeof requests; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => server.close() }))
  )
}

test('AI assistant: off by default (nothing sent), then consent-based rewrite streamed from Claude', async () => {
  const mock = await mockClaude(['Their ', 'results ', 'are ', 'accurate.'])
  const { app, page } = await launch({ env: { ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: 'sk-ant-test' } })
  try {
    await page.keyboard.press('ControlOrMeta+n')
    await doc(page).click()
    await page.keyboard.type('There results is acurate.')
    await page.keyboard.press('ControlOrMeta+a')

    // Off by default: the UI says so, and the main process refuses even a direct request.
    await page.getByRole('tab', { name: 'Tools', exact: true }).click()
    await page.getByRole('button', { name: 'AI assistant' }).click()
    await expect(page.getByText('The AI writing assistant is off.')).toBeVisible()
    const direct = await page.evaluate(() => window.simpleDocs.aiRun('x1', 'improve', '', 'secret text').then(() => 'sent', (e: Error) => e.message))
    expect(direct).toContain('turned off')
    expect(mock.requests).toHaveLength(0)

    // Turn it on in Settings.
    await page.getByRole('button', { name: 'Open AI settings' }).click()
    await page.getByRole('switch', { name: 'Use the AI writing assistant' }).click()
    await expect(page.getByRole('switch', { name: 'Use the AI writing assistant' })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // (closing Settings restores focus asynchronously; select once the editor really has it)
    await expect(async () => {
      await doc(page).click()
      await page.keyboard.press('ControlOrMeta+a')
      expect(await page.evaluate(() => document.getSelection()?.toString())).toContain('acurate')
    }).toPass()
    await page.getByRole('button', { name: 'AI assistant' }).click()
    await page.getByRole('radio', { name: 'Fix spelling & grammar' }).click()
    await expect(page.getByTestId('ai-outgoing')).toHaveText('There results is acurate.')
    expect(mock.requests).toHaveLength(0) // still nothing until Send
    await page.getByTestId('ai-send').click()
    await expect(page.getByTestId('ai-replace')).toBeVisible()
    await expect(page.getByTestId('ai-output')).toHaveText('Their results are accurate.')
    await page.getByTestId('ai-replace').click()
    await expect(doc(page)).toHaveText('Their results are accurate.')

    // Exactly one request, in the documented shape.
    expect(mock.requests).toHaveLength(1)
    const r = mock.requests[0]
    expect(r.url).toMatch(/^\/v1\/messages/)
    expect(String(r.headers['x-api-key'] ?? r.headers.authorization)).toContain('sk-ant-test')
    expect(String(r.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    expect(r.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, fallbacks: 'default', output_config: { effort: 'medium' } })
    const sent = JSON.stringify(r.body.messages)
    expect(sent).toContain('There results is acurate.')
    expect(sent).toContain('Correct spelling, grammar and punctuation')
  } finally {
    await quit(app)
    mock.close()
  }
})
