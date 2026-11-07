import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const script = resolve('scripts/release.mjs')
const names = [
  'Simple-Docs-Setup-0.2.0.exe', 'Simple-Docs-Setup-0.2.0.exe.blockmap',
  'Simple-Docs-0.2.0-arm64.dmg', 'Simple-Docs-0.2.0.dmg',
  'Simple-Docs-0.2.0-arm64.dmg.blockmap', 'Simple-Docs-0.2.0.dmg.blockmap',
  'Simple-Docs-0.2.0-arm64-mac.zip', 'Simple-Docs-0.2.0-mac.zip',
  'Simple-Docs-0.2.0-arm64-mac.zip.blockmap', 'Simple-Docs-0.2.0-mac.zip.blockmap',
  'Simple-Docs-0.2.0.AppImage', 'simple-docs_0.2.0_amd64.deb', 'simple-docs-0.2.0.x86_64.rpm',
  'latest.yml', 'latest-mac.yml', 'latest-linux.yml'
]
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture(initial: object[] = [], mode = '') {
  const cwd = mkdtempSync(join(tmpdir(), 'simple-docs-release-'))
  dirs.push(cwd)
  mkdirSync(join(cwd, 'dist'))
  mkdirSync(join(cwd, 'bin'))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '0.2.0' }))
  writeFileSync(join(cwd, 'CHANGELOG.md'), '## 0.2.0\n\nRelease notes\n\n## 0.1.0\nOld notes\n')
  for (const name of names) writeFileSync(join(cwd, 'dist', name), 'installer')
  for (const [manifest, asset] of [['latest.yml', names[0]], ['latest-linux.yml', names[10]], ['latest-mac.yml', names[6]]]) {
    const sha = createHash('sha512').update('installer').digest('base64')
    writeFileSync(join(cwd, 'dist', manifest), `version: 0.2.0\nfiles:\n  - url: ${asset}\n    size: 9\n    sha512: ${sha}\n`)
  }
  const state = join(cwd, 'state.json')
  writeFileSync(state, JSON.stringify(initial))
  // Stateful GitHub substitute: models drafts, partial uploads, and publication.
  writeFileSync(join(cwd, 'bin', 'gh'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), file = process.env.STATE;
const releases = JSON.parse(fs.readFileSync(file));
const save = () => fs.writeFileSync(file, JSON.stringify(releases));
const release = () => releases.find(r => r.tag_name === args[2]);
if (args[0] === 'api') { fs.writeFileSync(1, JSON.stringify([releases])); }
else if (args[1] === 'create') {
  if (!args.includes('--draft') || !args.includes('--verify-tag')) process.exit(2);
  releases.push({tag_name: args[2], draft: true, assets: []}); save();
} else if (args[1] === 'upload') {
  for (const p of args.slice(3, args.indexOf('--clobber'))) {
    if (process.env.MODE === 'upload-failure') process.exit(1);
    const name = path.basename(p);
    if (process.env.MODE === 'missing-remote' && name.endsWith('.exe')) continue;
    const r = release(); r.assets = r.assets.filter(a => a.name !== name);
    r.assets.push({name, size: fs.statSync(p).size, state: 'uploaded'}); save();
  }
} else if (args[1] === 'edit') { release().draft = false; save(); }
else process.exit(3);
`, { mode: 0o755 })
  return {
    cwd, state: () => JSON.parse(readFileSync(state, 'utf8')),
    run: (tag = 'v0.2.0') => spawnSync(process.execPath, [script, tag, 'dist'], {
      cwd, encoding: 'utf8', env: { ...process.env, PATH: `${join(cwd, 'bin')}:${process.env.PATH}`, STATE: state, MODE: mode, GITHUB_REPOSITORY: 'test/simple-docs' }
    })
  }
}

describe.skipIf(process.platform === 'win32')('release publication (Linux release runner)', () => {
  it('publishes a complete release and leaves it unchanged on retry', () => {
    const f = fixture()
    const result = f.run()
    expect(result.status, result.stderr).toBe(0)
    const published = f.state()
    expect(published).toHaveLength(1)
    expect(published[0].draft).toBe(false)
    expect(published[0].assets.map((a: { name: string }) => a.name).sort()).toEqual([...names].sort())
    expect(f.run().status).toBe(0)
    expect(f.state()).toEqual(published)
  })

  it.each(names)('does not publish without %s', name => {
    const f = fixture()
    rmSync(join(f.cwd, 'dist', name))
    expect(f.run().status).not.toBe(0)
    expect(f.state()).toEqual([])
  })

  it('rejects empty files and mismatched tags', () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'dist', names[0]), '')
    expect(f.run().status).not.toBe(0)
    expect(f.run('v0.3.0').status).not.toBe(0)
    expect(f.state()).toEqual([])
  })

  it.each(['upload-failure', 'missing-remote'])('leaves a draft after %s', mode => {
    const f = fixture([], mode)
    expect(f.run().status).not.toBe(0)
    expect(f.state()).toHaveLength(1)
    expect(f.state()[0].draft).toBe(true)
  })

  it('rejects updater metadata with incorrect checksums', () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'dist', names[0]), 'damaged installer')
    expect(f.run().status).not.toBe(0)
    expect(f.state()).toEqual([])
  })

  it('resumes a partial draft', () => {
    const f = fixture([{ tag_name: 'v0.2.0', draft: true, assets: [] }])
    expect(f.run().status).toBe(0)
    expect(f.state()).toHaveLength(1)
    expect(f.state()[0].draft).toBe(false)
    expect(f.state()[0].assets).toHaveLength(names.length)
  })

  it('normalizes spaces in builder output', () => {
    const f = fixture()
    const name = names[0]
    rmSync(join(f.cwd, 'dist', name))
    writeFileSync(join(f.cwd, 'dist', 'Simple Docs Setup 0.2.0.exe'), 'installer')
    expect(f.run().status).toBe(0)
  })
})
