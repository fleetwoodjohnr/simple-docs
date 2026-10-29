# Releasing Simple Docs

This is the checklist for producing installers.
- **Linux** (Fedora, x86-64): steps marked **verified** were run there.
- **Windows and macOS:** built and tested by GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) on every push.

## 1. Before the first release

- **Homepage.** `homepage` in `package.json` (`https://github.com/fleetwoodjohnr/simple-docs`) is published by the deb and rpm packages.
- **Maintainer.** The deb maintainer and rpm packager come from `author` in `package.json` (`Simple Docs <fleetwoodjohnr@gmail.com>`).
- **Signing.** Builds are **unsigned** by decision, so Windows SmartScreen and macOS Gatekeeper warn users on first launch.
  - macOS builds are signed *ad hoc* (`mac.identity: "-"`, `hardenedRuntime: false` in `electron-builder.yml`), because Apple Silicon refuses to run code with no signature at all.
  - To sign later on Windows, add a certificate as `CSC_LINK` and `CSC_KEY_PASSWORD`.
  - To sign later on macOS, remove the two ad-hoc lines, provide a Developer ID Application certificate, and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.
  - For both, add the values as repository secrets and pass them to the "Installers" step, then drop `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.

## 2. Version

1. Bump `version` in `package.json`.
2. Turn the "Unreleased" section of `CHANGELOG.md` into the new version's section.
3. Update the date line in `IMPLEMENTATION_STATUS.md`.

## 3. CI: all three platforms

Every push runs the `CI` workflow on `ubuntu-latest`, `windows-latest` and `macos-latest`. Each job runs:
1. typecheck
2. unit tests
3. build
4. E2E (Playwright on Electron; under xvfb on Linux)
5. `electron-builder` for that OS
6. the E2E suite again against the packaged app
7. upload of the installers as artifacts

Then the `linux-install` job installs the deb into clean Ubuntu 22.04, 24.04 and 26.04 containers and the rpm into Fedora 44, and fails if `ldd` reports a library that doesn't resolve. A newer push to the same branch cancels the run in progress; tag runs always finish.

The test tools are installed per OS: poppler everywhere, plus LibreOffice and `rpm` on Linux. On Windows, poppler comes from the runner's MSYS2. A failed job uploads `test-results/`, with Playwright traces.

What each OS produces:

| OS | Installers |
|---|---|
| Linux | `Simple Docs-<v>.AppImage`, `simple-docs_<v>_amd64.deb`, `simple-docs-<v>.x86_64.rpm` |
| Windows | `Simple Docs Setup <v>.exe` (NSIS, x64, per-user or per-machine, choice of folder) |
| macOS | `Simple Docs-<v>-arm64.dmg`, `Simple Docs-<v>.dmg` (x64), and zips of both |

**Releasing:** push a tag `v<version>`. After the build and install jobs pass, the `release` job creates a **draft** GitHub release. The draft contains every installer, and its notes are the newest `CHANGELOG.md` section. Review the draft and publish it.

## Updates (electron-updater)

Installed copies check the newest **published** release of `fleetwoodjohnr/simple-docs` (the `publish` block in `electron-builder.yml`). Drafts and pre-releases are invisible to them, so **publishing the draft is what ships the update**.

- **What the updater reads.** The release must carry `latest.yml` (Windows), `latest-mac.yml` and `latest-linux.yml`, plus the blockmaps. They list each installer with its sha512, which is checked after download. CI uploads them, and the release job renames assets so spaces become dashes, as those files expect. Don't rename or delete release assets by hand.
- **The version must go up** (semver). An installed copy only offers a release with a higher version than its own.
- **What happens per platform** when the user clicks Install, then Restart:
  - Windows: the NSIS installer runs silently, then the app relaunches.
  - AppImage: the file is replaced, then the app relaunches.
  - rpm / deb: `pkexec dnf install` (or apt) asks for the admin password, then the app relaunches.
  - macOS: the release page opens in the browser instead, because macOS only applies updates to apps with a Developer ID signature, and ours are signed ad hoc. With signing in place, this branch in `src/main/updater.ts` can go.
- **Users of 0.1.0** have no updater, so they install 0.2.0 by hand once.
- **Test.** `tests/e2e/update.spec.ts` runs against the packaged app (part of the packaged E2E on every OS). It serves a 99.0.0 release from a local feed and checks the prompt, the verified download and the restart prompt. The only part not exercised automatically is the final install step (installer, pkexec); check it by hand when the second updater-enabled release ships.

## 4. Test locally (verified on Linux)

```bash
npm run typecheck          # strict TypeScript, main + renderer
npm test                   # unit tests, incl. the compatibility corpus (golden round trips)
npm run e2e:headless       # build + Playwright on Electron under xvfb (CSP-violation guard on every test)
```

- **Optional tools.** Tests that need poppler (`pdftotext`, `pdftoppm`) or LibreOffice (`soffice`) look for them on PATH and skip without them.
- **Corpus goldens.** They are in `tests/unit/__corpus__/`. If a format change alters what survives a round trip, run `npx vitest run tests/unit/corpus.test.ts -u`, review the diff of those files and commit it with the change.

## 5. Build locally

```bash
npm run dist                       # = npm run build && electron-builder (targets for the current OS)
npx electron-builder --linux dir   # unpacked app only, quickest for smoke tests
```

Output goes to `release/`.

**deb and rpm on a host without fpm's libraries (verified).** On Fedora, electron-builder's bundled fpm needs `libcrypt.so.1` (libxcrypt-compat), and rpm needs `rpmbuild`. Without installing either on the host, package the unpacked app in a throwaway container:

```bash
npx electron-builder --linux dir
podman run --rm --security-opt label=disable -v "$PWD":/src -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder -w /src \
  registry.fedoraproject.org/fedora-toolbox:44 bash -c \
  "dnf install -y -q nodejs24 libxcrypt-compat rpm-build binutils && node-24 node_modules/.bin/electron-builder --linux deb rpm --prepackaged release/linux-unpacked"
```

**What the package contains:**
- **Main-process dependencies only.** The renderer is bundled by Vite, so only `@anthropic-ai/sdk`, `tesseract.js` and the English OCR model are packaged.
- **The OCR worker, unpacked.** The OCR worker and everything it requires are unpacked from the asar archive, because a worker thread can't start from inside the asar. If a new version of tesseract.js adds dependencies, add them to `asarUnpack`. The packaged smoke test catches a missing one: OCR start-up fails after 30 seconds instead of hanging.
- **Explicit deb and rpm dependencies.** They are listed in `electron-builder.yml`, because electron-builder's defaults miss ALSA and GBM (and libsecret on rpm). Clean installs found this.

## 6. Smoke-test the packages (verified on Linux)

```bash
# the whole E2E suite against the packaged binary
SD_PACKAGED=$PWD/release/linux-unpacked/simple-docs xvfb-run -a npx playwright test
# the AppImage itself (no FUSE needed)
APPIMAGE_EXTRACT_AND_RUN=1 SD_PACKAGED="$PWD/release/Simple Docs-<version>.AppImage" xvfb-run -a npx playwright test packaged
# deb / rpm: install into clean containers and check that every shared library resolves (CI does this on every push)
podman run --rm -v "$PWD/release":/rel:ro quay.io/toolbx/ubuntu-toolbox:24.04 bash -c \
  'apt-get update -qq && apt-get install -y /rel/simple-docs_<version>_amd64.deb && ldd "/opt/Simple Docs/simple-docs" | grep "not found"; true'
podman run --rm -v "$PWD/release":/rel:ro registry.fedoraproject.org/fedora-toolbox:44 bash -c \
  'dnf install -y /rel/simple-docs-<version>.x86_64.rpm && ldd "/opt/Simple Docs/simple-docs" | grep "not found"; true'
```

Results so far:
- All 34 E2E tests pass against `linux-unpacked`.
- The packaged test passes against the AppImage and against the binary from the deb.
- The deb installs with every library resolved on Ubuntu 22.04, 24.04 and 26.04, and the rpm on Fedora 44.

## 7. Manual checks before publishing

- **Files from other apps.** Open a real-world DOCX from Word and an ODT from LibreOffice, save each, then reopen the result in Word or LibreOffice. In Word, check a chart made in Simple Docs: *Edit Data* should open its workbook.
- **Print and PDF.** Print one page to a real printer. Export a PDF and open it in another viewer.
- **AI assistant.** Turn it on with a real key, run one request, then turn it off again.
- **Updates.** With the previous release installed, publish the new one, then use Settings → Updates → *Check now*: Install, then Restart, should bring up the new version.
- **Privacy.** With the assistant and the update check off, no network traffic leaves the app (check with, for example, `nethogs` or Little Snitch).
- **Windows and macOS.** Install the CI-built installers once by hand: file associations, the first-launch warning for unsigned builds, and the window controls.

## 8. Publish

Publish the draft release that CI created, or attach the installers to a release by hand with the `CHANGELOG.md` section. Link `COMPATIBILITY.md` for what each format keeps.
