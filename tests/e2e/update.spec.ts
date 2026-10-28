import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launch, quit } from './helpers'

// The updater against a local release feed. Packaged builds only: development builds never check.
test.skip(!process.env.SD_PACKAGED, 'set SD_PACKAGED to the packaged executable')

test('update check: offers the newer version, downloads and verifies it, then offers a restart', async () => {
  // A release 99.0.0 with one file per installer type; each platform's updater picks its own.
  const payload = randomBytes(4096)
  const sha512 = createHash('sha512').update(payload).digest('base64')
  const files = ['AppImage', 'deb', 'rpm', 'exe', 'zip'].map((ext) => `  - url: simple-docs-99.0.0.${ext}\n    sha512: ${sha512}\n    size: ${payload.length}`)
  const feed = `version: 99.0.0\nfiles:\n${files.join('\n')}\npath: simple-docs-99.0.0.zip\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`
  const server = createServer((req, res) => {
    const name = (req.url ?? '').split('?')[0].slice(1)
    if (/^latest(-linux|-mac)?\.yml$/.test(name)) return void res.end(feed)
    if (/^simple-docs-99\.0\.0\.\w+$/.test(name)) return void res.end(payload)
    res.statusCode = 404 // e.g. the NSIS blockmap: the updater falls back to a full download
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { app, page } = await launch({ settings: { updateCheck: false }, env: { SD_UPDATE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } })
  try {
    // Answer the native prompts: Install, then Later (so the window stays open); record what was shown.
    await app.evaluate(({ dialog, shell }) => {
      const log: string[] = []
      ;(globalThis as { sdLog?: string[] }).sdLog = log
      dialog.showMessageBox = (async (...args: { message: string; buttons?: string[] }[]) => {
        const o = args[args.length - 1]
        log.push(o.message)
        return { response: o.buttons?.[0] === 'Restart now' ? 1 : 0, checkboxChecked: false }
      }) as never
      shell.openExternal = (async (url: string) => void log.push(`open ${url}`)) as never
    })
    await page.evaluate(() => window.simpleDocs.checkForUpdates())
    const log = await app.evaluate(() => (globalThis as { sdLog?: string[] }).sdLog)
    expect(log?.[0]).toBe('Simple Docs 99.0.0 is available')
    // macOS: unsigned builds can't self-update, so the release page opens instead.
    expect(log?.[1]).toBe(process.platform === 'darwin' ? 'open https://github.com/fleetwoodjohnr/simple-docs/releases/tag/v99.0.0' : 'Simple Docs 99.0.0 is ready to install')
  } finally {
    await quit(app)
    server.close()
  }
})
