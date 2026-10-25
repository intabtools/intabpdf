<p align="center">
  <img src="public/favicon.svg" alt="InTab PDF logo" width="96" height="96">
</p>

<h1 align="center">InTab PDF</h1>

<p align="center">
  Privacy-first PDF tools that run entirely on your device.<br>
  No account. No uploads. No tracking. No ads.
</p>

<p align="center">
  A community project by <a href="https://github.com/intabtools">intabtools</a>, made by students, for everyone.
</p>

<p align="center">
  <a href="https://github.com/intabtools/intabpdf/actions/workflows/build.yml"><img src="https://github.com/intabtools/intabpdf/actions/workflows/build.yml/badge.svg?branch=main" alt="Build status of main"></a>
  <!--<a href="https://github.com/intabtools/intabpdf/releases/latest"><img src="https://img.shields.io/github/v/release/intabtools/intabpdf?include_prereleases&label=latest" alt="Latest release"></a> -->
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <!--<img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS"> -->
  <img src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Capacitor-119EFF?logo=capacitor&logoColor=white" alt="Capacitor">
  <img src="https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white" alt="Node.js">
</p>

---

## Project status

InTab PDF provides private, local PDF tools and viewing across Web, Desktop (Electron), and Android (Capacitor).

### Implemented tools
- **Merge PDF**: Combine multiple PDFs into a single document with drag-and-drop ordering.
- **Rotate PDF**: Rotate all or selected pages in 90-degree increments.
- **Remove Pages**: Delete individual pages or page ranges with live validation.
- **Split PDF**: Extract page ranges or split documents into multiple PDFs.
- **Images to PDF**: Convert JPG, PNG, and WebP images to PDF with reordering, A4/Fit sizing, and preview lightbox.
- **Compress PDF**: Optimize PDF size by setting target file size (KB/MB) or presets.

### Viewing workflow by platform
- **Web**: Generated PDFs and opened files open directly in a new browser tab using native browser PDF capabilities, avoiding redundant embedded reader overhead.
- **Desktop (Electron) and Mobile (Android)**: Built-in in-app PDF viewer featuring asynchronous fulltext search with match navigation, fit-to-width, zoom (25% to 400%), page thumbnail rail, document close action, and distraction-free reading mode.

## Why InTab PDF

Most online PDF tools ask you to upload your files to a server. We do not think that is right, so InTab PDF works differently.

- Everything runs on your device.
- No backend, no account, no tracking, no ads.
- Open source and community driven.

## How we build

We are a group of students, so the code must be easy for everyone to read and change. We follow four simple goals.

- **Simple.** The plain way is the best way. No clever tricks.
- **Modular.** One tool, one folder. Tools do not depend on each other.
- **Explainable.** You should be able to say what a file does in one or two sentences.
- **Maintainable.** Small PRs, tests for PDF logic, and docs that match the code.

## Platforms

| Platform | Technology | Status |
|---|---|---|
| Web | Vite + React + TypeScript | Fully functional client-side tools with native tab PDF viewing |
| Desktop | Electron | Fully functional with embedded PDF viewer and offline tools |
| Android | Capacitor | Fully functional mobile app with embedded viewer and offline tools |

## Quick start

You need [Node.js](https://nodejs.org) (current LTS).

```bash
git clone https://github.com/intabtools/intabpdf.git
cd intabpdf
npm install
npm run dev
```

The app may not show much yet, and that is okay. We are building it step by step.

## Want to help?

1. Read [contributing.md](https://github.com/intabtools/intabpdf/blob/main/docs/contributing.md). It is short.
2. Look for issues labelled `good first issue`.
3. Ask questions anytime. Nobody expects you to know everything.

## Docs

You do not need to read everything. Start with the first two files and come back to the others when you need them.

| File | What it covers |
|---|---|
| [contributing.md](https://github.com/intabtools/intabpdf/blob/main/docs/contributing.md) | How to help, step by step |
| [architecture.md](https://github.com/intabtools/intabpdf/blob/main/docs/architecture.md) | How we plan to arrange the code |
| [folder-guide.md](https://github.com/intabtools/intabpdf/blob/main/docs/folder-guide.md) | What each folder is for |
| [adding-a-tool.md](https://github.com/intabtools/intabpdf/blob/main/docs/adding-a-tool.md) | Build a new tool step by step |
| [privacy.md](https://github.com/intabtools/intabpdf/blob/main/docs/privacy.md) | Our privacy promise and rules |
| [commit-conventions.md](https://github.com/intabtools/intabpdf/blob/main/docs/commit-conventions.md) | How to write commit messages |
| [code-quality.md](https://github.com/intabtools/intabpdf/blob/main/docs/code-quality.md) | Friendly tips for clean code |
| [dependencies.md](https://github.com/intabtools/intabpdf/blob/main/docs/dependencies.md) | Adding libraries safely |
| [platforms.md](https://github.com/intabtools/intabpdf/blob/main/docs/platforms.md) | Web, desktop and Android plans |
| [maintainer-guide.md](https://github.com/intabtools/intabpdf/blob/main/docs/maintainer-guide.md) | For people who review PRs and make releases |
| [decisions.md](https://github.com/intabtools/intabpdf/blob/main/docs/decisions.md) | Why we made some key choices |
| [api-reference.md](https://github.com/intabtools/intabpdf/blob/main/docs/api-reference.md) | Technical reference for types, interfaces, worker protocols |

## Security

Found a security or privacy problem? Please tell us privately. See [SECURITY.md](SECURITY.md).

## License

See [LICENSE](LICENSE).