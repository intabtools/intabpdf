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

## About

InTabPDF is a free, open-source PDF toolkit for Web, Desktop, and Android. It helps you create, view, organize, convert, and protect PDF documents directly on your own device without creating an account or sending files to a server.

## What you can do

- **Create PDFs:** Turn images (`JPG`, `PNG`, `WebP`) or plain text into PDF files.
- **Organize pages:** Merge multiple PDFs, split pages out, reorder pages, rotate pages, and remove pages.
- **Compress and secure:** Reduce PDF file size (using presets or a target size), add password protection and permissions, and unlock supported encrypted PDFs (`RC4` and `AES-256`) when you know the password.
- **Add visual signatures:** Draw, type, or upload a signature image (with an optional date) to stamp onto a page. This places a visual image rather than a cryptographic digital signature.
- **Convert and extract:** Export PDF pages as `PNG` or `JPEG` images (or a `.zip` archive) and extract text to `.txt`.
- **View PDFs:** Read documents in the built-in offline viewer on Desktop and Android (with search, zoom, thumbnails, and reading mode), or open them in your browser's PDF tab on the Web.
- **Scan paper documents (Android only):** Capture multi-page scans with your camera or gallery, crop and filter pages, and export them to PDF inside the Android app.

## Available platforms

- **Web:** Browser-based application at [intabpdf.pages.dev](https://intabpdf.pages.dev) with all 13 PDF tools and native browser tab viewing.
- **Desktop:** Electron application for Windows and Linux with all PDF tools and the built-in offline viewer. Installers are published on [GitHub Releases](https://github.com/intabtools/intabpdf/releases/latest); macOS builds are not currently provided.
- **Android:** Native Android application (Capacitor) with all PDF tools, the built-in offline viewer, Storage Access Framework (SAF) file saving and recovery protection, an **InTabPDF – Save to Device** share target, and the Android-only document scanner.

## Privacy

InTabPDF processes documents locally on your device. There are no accounts, no analytics or ads, and no automatic document uploads.

Network activity is limited to actions you explicitly choose, such as opening repository links or using the viewer's **Search the web** option on selected text. On Android, temporary staging and recovery files may be stored locally in app-private storage during saves or scans until the operation finishes or you confirm deletion. See the [Privacy Guide](docs/privacy.md) for full details.

## Getting started

Requires [Node.js](https://nodejs.org) 20+ LTS (or Node 22+; `scripts/cap.cjs` wraps Capacitor CLI v8 for Node 20 compatibility). Building the Android app also requires Java 21 and Android SDK 36.

```bash
git clone https://github.com/intabtools/intabpdf.git
cd intabpdf
npm install
npm run dev
```

Useful scripts:

```bash
npm test                                       # Run Vitest unit and component tests
npm run test:e2e                               # Run Playwright end-to-end browser tests
npm run lint                                   # Run ESLint checks
npm run build                                  # Build production web bundle (dist/)
npm run build:desktop                          # Build web assets for Electron
npm run dist                                   # Package Electron desktop installers
npm run sync:android && npm run android:build  # Sync web assets and build debug Android APK
```

## Documentation

Start with the [Contributing Guide](docs/contributing.md) and [Architecture Guide](docs/architecture.md), or jump directly to a topic:

| Document | Covers |
|---|---|
| [Contributing Guide](docs/contributing.md) | Setup, PR workflow, and contributor guidelines |
| [Architecture Guide](docs/architecture.md) | App shell, tool registry, worker pipeline, CSP, Electron IPC, and Android plugins |
| [Platforms & Builds](docs/platforms.md) | Web, Desktop, and Android capabilities, SAF saving, scanner, and packaging |
| [Privacy Guide](docs/privacy.md) | Privacy rules, local storage behavior, CSP, and platform checks |
| [Folder Guide](docs/folder-guide.md) | Repository directory layout and file placement rules |
| [Adding a Tool](docs/adding-a-tool.md) | Step-by-step guide to building and registering a PDF tool |
| [API Reference](docs/api-reference.md) | TypeScript interfaces, worker API, and native bridge contracts |
| [Dependencies](docs/dependencies.md) | Library selection, licensing, and update rules |
| [Code Quality](docs/code-quality.md) | Engineering, testing, and accessibility conventions |
| [Commit Conventions](docs/commit-conventions.md) | Commit message prefixes and formatting |
| [Maintainer Guide](docs/maintainer-guide.md) | Review checklist, CI/CD, and release steps |
| [Decisions Log](docs/decisions.md) | Architecture Decision Records |

## Security and license

- Report security or privacy issues privately by following [SECURITY.md](SECURITY.md).
- Released under the [MIT License](LICENSE).
