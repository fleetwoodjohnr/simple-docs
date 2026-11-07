import { readFileSync, readdirSync, renameSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Run only after every platform's build and installation checks have succeeded.
const [tag, directory = 'dist'] = process.argv.slice(2)
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
if (tag !== `v${version}`) throw new Error(`Release tag must be v${version}; got ${tag}`)
const repo = process.env.GITHUB_REPOSITORY
if (!repo) throw new Error('GITHUB_REPOSITORY is required')

const expected = [
  `Simple-Docs-Setup-${version}.exe`, `Simple-Docs-Setup-${version}.exe.blockmap`,
  `Simple-Docs-${version}.AppImage`, `simple-docs_${version}_amd64.deb`, `simple-docs-${version}.x86_64.rpm`,
  'latest.yml', 'latest-mac.yml', 'latest-linux.yml'
]
for (const arch of ['-arm64', '']) {
  for (const suffix of ['.dmg', '.dmg.blockmap', '-mac.zip', '-mac.zip.blockmap']) {
    expected.push(`Simple-Docs-${version}${arch}${suffix}`)
  }
}

// electron-updater's manifests use dashes where builder output may have spaces.
for (const name of readdirSync(directory)) {
  if (!name.includes(' ')) continue
  const normalized = join(directory, name.replaceAll(' ', '-'))
  if (existsSync(normalized)) throw new Error(`Duplicate asset: ${normalized}`)
  renameSync(join(directory, name), normalized)
}
for (const name of expected) {
  const file = join(directory, name)
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error(`Missing or empty release asset: ${name}`)
  }
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
// Listing drafts as well as published releases allows interrupted uploads to resume.
const lookup = () => JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`))
  .flat().find(release => release.tag_name === tag)
function verify(release, compareSizes = false) {
  for (const name of expected) {
    const asset = release?.assets.find(asset => asset.name === name)
    if (!asset || asset.state !== 'uploaded' || asset.size <= 0 ||
        (compareSizes && asset.size !== statSync(join(directory, name)).size)) {
      throw new Error(`Release upload missing or incomplete: ${name}`)
    }
  }
}

let release = lookup()
if (release && !release.draft) {
  verify(release)
  console.log(`${tag} is already published with all required downloads`)
} else {
  if (!release) {
    const section = readFileSync('CHANGELOG.md', 'utf8').split(/^## /m)[1]
    const notes = section && `## ${section}`
    if (!notes) throw new Error('No release notes found in CHANGELOG.md')
    writeFileSync('notes.md', notes)
    gh('release', 'create', tag, '--repo', repo, '--draft', '--verify-tag',
      '--title', `Simple Docs ${version}`, '--notes-file', 'notes.md')
  }
  gh('release', 'upload', tag, ...expected.map(name => join(directory, name)), '--clobber', '--repo', repo)
  release = lookup()
  verify(release, true)
  gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--verify-tag')
  console.log(`Published ${tag} with all required downloads`)
}
