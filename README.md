<p align="center">
  <img src="public/favicon.svg" alt="InTabPDF logo" width="88" height="88">
</p>

<h1 align="center">InTabPDF</h1>

<p align="center">
  Privacy-first PDF tools that run entirely on your device.<br>
  No account. No uploads. No tracking. No ads.
</p>

<p align="center">
  <a href="https://intabpdf.pages.dev"><strong>Try Web App</strong></a>
  &middot;
  <a href="https://github.com/intabtools/intabpdf/releases/latest"><strong>Latest Published Release</strong></a>
  &middot;
  <a href="docs/contributing.md"><strong>Contributing</strong></a>
</p>

<p align="center">
  <a href="https://github.com/intabtools/intabpdf/actions/workflows/ci.yml"><img src="https://github.com/intabtools/intabpdf/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build status of main"></a>
  <a href="https://github.com/intabtools/intabpdf/releases/latest"><img src="https://img.shields.io/github/v/release/intabtools/intabpdf?include_prereleases&label=latest" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

---

> Preparing for **InTabPDF 2.0.0** (upcoming release). The [latest release link](https://github.com/intabtools/intabpdf/releases/latest) points to the latest published GitHub release until 2.0.0 is tagged and published.

## Capabilities (2.0.0 release target)

All 13 PDF tools run locally on your device across Web, Desktop (Windows and Linux), and Android:

- **Create**: Images to PDF (JPG, PNG, WebP input), Text to PDF
- **Organize**: Merge, Split, Reorder pages, Rotate pages, Remove pages
- **Shrink and secure**: Compress (presets or target size), Protect (password and permissions), Unlock
- **Sign and convert**: Sign (draw, type, or upload PNG/JPEG/WebP with optional date), PDF to images (PNG, JPEG, or ZIP), Extract text (`.txt`)

### Viewing by platform

- **Web**: Opens PDFs directly in a browser tab using your browser's native PDF viewer.
- **Desktop (Electron) and Android (Capacitor)**: Includes a built-in offline PDF viewer with full-text search, zoom (25% to 400%), fit-to-width, thumbnail rail, and reading mode.

## Try or install

- **Web**: Open [intabpdf.pages.dev](https://intabpdf.pages.dev) in any modern browser.
- **Desktop and Android**: View the [latest published GitHub release](https://github.com/intabtools/intabpdf/releases/latest) for currently available downloads. Starting with the 2.0.0 release workflow, published releases attach Windows (`.exe`, `.zip`), Linux (`.AppImage`, `.deb`, `.rpm`, `.tar.gz`), and Android (`.apk`) packages along with `SHA256SUMS.txt` and `SHA256SUMS.txt.asc`.
- **macOS**: Deferred pending app icons and Apple code signing/notarization.

## Privacy by design

- Files stay in memory on your device and are never automatically uploaded to a server.
- Zero backend, accounts, analytics, crash reporters, or ads.
- Web builds enforce a strict Content Security Policy (`public/_headers`) with no remote scripts or third-party CDNs.

## Quick start (Development)

Requires [Node.js](https://nodejs.org) (v20+ LTS via `scripts/cap.cjs` wrapper, or Node 22+ for Capacitor CLI).

```bash
git clone https://github.com/intabtools/intabpdf.git
cd intabpdf
npm install
npm run dev
```

Common contributor commands:

```bash
npm test            # Run Vitest unit and integration tests
npm run test:e2e    # Run Playwright end-to-end tests
npm run lint        # Run ESLint and Prettier checks
npm run build       # Build production web bundle (dist/)
npm run dist        # Package Electron desktop installers
npm run sync:android && npm run android:build  # Sync assets and build Android APK
```

## Documentation

Start with [contributing.md](docs/contributing.md) and [architecture.md](docs/architecture.md), or jump to a specific guide:

| Document | Covers |
|---|---|
| [contributing.md](docs/contributing.md) | Setup, PR workflow, and contributor guidelines |
| [architecture.md](docs/architecture.md) | App shell, registry, worker pipeline, and CSP architecture |
| [folder-guide.md](docs/folder-guide.md) | Repository directory layout |
| [adding-a-tool.md](docs/adding-a-tool.md) | Step-by-step guide to adding a PDF tool |
| [api-reference.md](docs/api-reference.md) | TypeScript interfaces, worker API, and native bridge types |
| [privacy.md](docs/privacy.md) | Privacy rules and CSP verification |
| [platforms.md](docs/platforms.md) | Web, Electron, and Android packaging and builds |
| [dependencies.md](docs/dependencies.md) | Library selection and license rules |
| [code-quality.md](docs/code-quality.md) | Engineering and testing conventions |
| [commit-conventions.md](docs/commit-conventions.md) | Commit message format |
| [maintainer-guide.md](docs/maintainer-guide.md) | Release checklist, CI/CD, and security handling |
| [decisions.md](docs/decisions.md) | Architecture Decision Records |

## Security and license

- Report security or privacy issues privately following [SECURITY.md](SECURITY.md).
- Released under the [MIT License](LICENSE).