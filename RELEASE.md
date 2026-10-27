# Releasing Simple Docs

This is the checklist for producing installers. Steps marked **verified** were run on Linux (Fedora, x86-64) for 0.1.0. The Windows and macOS steps follow electron-builder's documented setup but have **not** been run yet: no Windows or macOS build host was available.

## 1. Prerequisites

- Node 24+ and npm 11+. Run `npm ci` from a clean checkout. Electron downloads its binary on the first run.
- **Linux** (verified): nothing else for AppImage. For the `pdftotext`/`pdfinfo` test checks, install poppler-utils. For the independent-consumer tests, install LibreOffice.
- **deb / rpm** (not built for 0.1.0): fpm needs package metadata. Add a real `homepage` and an `author` with `name` and `email` to `package.json`. Install `rpmbuild` for rpm. Then set `linux.target: [AppImage, deb, rpm]` in `electron-builder.yml`.
- **Windows** (not verified): build on Windows. For signing, set `CSC_LINK` (a .pfx path or base64) and `CSC_KEY_PASSWORD`.
- **macOS** (not verified): build on macOS. For signing, use a Developer ID Application certificate in the keychain. For notarization, set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

Without signing, the installers work, but Windows SmartScreen and macOS Gatekeeper warn users.

## 2. Version

1. Bump `version` in `package.json`.
2. Add a section to `CHANGELOG.md`.
3. Update the date line in `IMPLEMENTATION_STATUS.md`.

## 3. Test (verified)

```bash
npm run typecheck          # strict TypeScript, main + renderer
npm test                   # unit tests, incl. the compatibility corpus (golden round trips)
npm run e2e:headless       # build + Playwright on Electron under xvfb (CSP-violation guard on every test)
```

The corpus goldens are in `tests/unit/__corpus__/`. If a format change alters what survives a round trip, run `npx vitest run tests/unit/corpus.test.ts -u`, review the diff of those files and commit it along with the change.

## 4. Build

```bash
npm run dist               # = npm run build && electron-builder (targets for the current OS)
npx electron-builder --dir # unpacked app only, quickest for smoke tests
```

Output goes to `release/`. On Linux that is `Simple Docs-<version>.AppImage` (about 150 MB) and `linux-unpacked/`.

What the package contains:
- **Main-process dependencies.** The renderer is bundled by Vite, so only main-process dependencies are packaged: `@anthropic-ai/sdk`, `tesseract.js` and the English OCR model.
- **The OCR worker and everything it requires**, unpacked from the asar archive. A worker thread can't start from inside the asar. If a new version of tesseract.js adds dependencies, add them to `asarUnpack`. The packaged smoke test catches this: an OCR worker that can't load its dependencies used to hang silently, and now fails after 30 seconds.

## 5. Smoke-test the packaged app (verified on Linux)

```bash
# the focused packaged test: DOCX, spelling, equations, PDF export, PDFium, OCR
SD_PACKAGED=$PWD/release/linux-unpacked/simple-docs xvfb-run -a npx playwright test packaged
# the whole E2E suite against the packaged binary
SD_PACKAGED=$PWD/release/linux-unpacked/simple-docs xvfb-run -a npx playwright test
# the AppImage itself (no FUSE needed)
APPIMAGE_EXTRACT_AND_RUN=1 SD_PACKAGED="$PWD/release/Simple Docs-<version>.AppImage" xvfb-run -a npx playwright test packaged
```

For 0.1.0, all 33 E2E tests passed against `linux-unpacked`, and the packaged test passed against the AppImage.

## 6. Manual checks before publishing

- Open a real-world DOCX from Word and an ODT from LibreOffice, save each, then reopen the result in Word or LibreOffice.
- Print one page to a real printer, and export a PDF and open it in another viewer.
- Turn the AI assistant on with a real key, run one request, then turn it off again.
- Check the app's privacy promise: with the assistant off, no network traffic leaves the app (for example with `nethogs` or Little Snitch).

## 7. Publish

Attach the installers to the release and include the `CHANGELOG.md` section. Link `COMPATIBILITY.md` for what each format keeps.
