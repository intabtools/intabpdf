# Decisions log

This page records why we made some important choices, so nobody has to guess later. Add a new entry when you make a decision that someone may question in future. Add new entries at the bottom. Please do not rewrite old entries. If a decision changes, add a new entry that replaces the old one.

## Template

```
## NNN: Title
Status: accepted (or: replaced by NNN)
Context: what problem or choice we had
Decision: what we chose
Consequences: what becomes easier and what becomes harder
```

---

## 001: Fully client-side, no backend

Status: accepted

Context: Online PDF tools usually upload files to a server. This is a privacy risk, and it also costs money to run.

Decision: All processing happens on the user's device. No backend, no accounts, no file storage.

Consequences: Strong privacy and no server cost. Speed depends on the user's device, so heavy work goes in Web Workers.

## 002: One TypeScript implementation for all platforms

Status: replaced by 011 (the desktop shell changed from Tauri to Electron; the one-TypeScript-implementation idea stays)

Context: We plan a web app, a desktop app (Tauri) and an Android app (Capacitor).

Decision: Tauri and Capacitor load the same web build. No native PDF code in Rust or Kotlin.

Consequences: A feature reaches all platforms together and behaves the same. The native apps stay thin.

## 003: Modular tool folders with a registry

Status: accepted

Context: Many contributors and many tools can cause merge conflicts and messy code.

Decision: Each tool lives in `src/tools/<name>/` and is listed in `tools/registry.ts`. Shared PDF logic lives in `core/`.

Consequences: People can build tools in parallel. The home grid and routes are made from the registry.

## 004: BrowserRouter and HashRouter

Status: replaced by 012

Context: Static hosting, Tauri and Capacitor have no server to rewrite URLs.

Decision: Use `BrowserRouter` and `HashRouter`.

Consequences: Works everywhere without extra setup.

## 005: Commit format `area: description`

Status: accepted

Context: We want a clear history without heavy tooling.

Decision: Use a lowercase area prefix from a fixed list. See [Commit conventions](commit-conventions.md).

Consequences: Easy to read and filter. It is not exactly Conventional Commits, so changelog tools need a small custom setup.

## 006: Enforce architecture with tools, not only with reviews

Status: replaced by 007

Context: Reviewers can forget rules, and contributors are often new.

Decision: Use ESLint import restrictions and CI so folder mistakes fail automatically.

Consequences: Less review effort and fewer arguments, but some setup work at the start.

## 007: Keep the process light while the project is small

Status: accepted

Context: The project has just started and the team is a few students. Too many rules and checks can scare new contributors and slow everyone down.

Decision: Start with a few simple rules (the privacy promise and the folder rules in [Architecture](architecture.md)). Treat other guidelines as tips. Add ESLint boundary checks and CI later, when the codebase and the team are bigger.

Consequences: Easier for newcomers to join and send their first PR. Reviewers need to watch the folder rules by hand for now.

## 008: Keep `pages/`, drop the global `workers/` folder

Status: accepted

Context: The repo started with `src/pages/` and `src/workers/` folders. They group files by type, which clashes with decision 003 (everything for one tool lives in its own folder). We also need a place for screens that are not tools, like Home and Donate.

Decision: Keep `src/pages/` only for non-tool screens. Remove `src/workers/`: each tool keeps its worker in `src/tools/<name>/`, shared message types go in `src/tools/types.ts` and the shared hook goes in `src/hooks/`. Global CSS moves to `src/styles/`.

Consequences: One place to look for everything about a tool, and fewer merge conflicts. Contributors must not put tool pages in `pages/`. Reviewers need to watch for this by hand for now (see decision 007).

## 009: Keep types next to the code that uses them

Status: accepted

Context: A global `src/types/` folder becomes a dumping ground over time. It also lets `core` depend on files outside `core`, which breaks the architecture rules.

Decision: There is no global types folder. A type stays in the file that uses it. Types shared inside a folder go in that folder's `types.ts`, for example `core/types.ts`, `platform/types.ts` and `tools/types.ts`.

Consequences: A file can be understood without searching the project, and `core` stays independent. If a type is needed in many folders, we move it to the lowest folder that all of them are allowed to import from.

## 010: Simple and explainable code comes first

Status: accepted

Context: This is a group project of students with different levels, and it is at a very early stage.

Decision: Our four goals are simple, modular, explainable and maintainable. When two solutions work, we choose the one that is easier to explain. We build only what is needed now.

Consequences: Code may look plainer, but anyone can read it, review it and take it over. Reviewers can ask for a simpler version of a PR.

## 011: Electron instead of Tauri for desktop

Status: accepted (replaces the desktop part of 002)

Context: We planned to use Tauri for the desktop app. Tauri uses the WebView that comes with each operating system. So the app can behave differently on Windows, on Linux and on different versions of the same system. A PDF tool uses workers, canvas and a lot of memory, so we want the same behaviour everywhere.

Decision: Use Electron for desktop. Electron comes with its own Chromium, so every install runs the same engine. It loads the same web build (`dist/`). The main process (`electron/main.cjs`) only sets up the window, opens files and saves files. The preload script (`electron/preload.cjs`) is the only bridge to the React code. Context isolation, sandbox and web security are on. Node integration in the renderer is off. The URLs that can load, and the navigation, are limited. We build the packages with Electron Builder: NSIS and ZIP for Windows, and AppImage, DEB, RPM and TAR.GZ for Linux. There is still no PDF logic in the shell.

Consequences: The app behaves the same on every desktop system. Nobody needs to learn Rust. Windows packages can be built from a Linux machine. The downside is that downloads and memory use are bigger, because Chromium is inside the app. We must update Electron often for security fixes. The main process and preload are sensitive, so we keep them small and review them carefully. macOS packaging is not set up yet. We still need to test the installers and file associations on real Windows and Linux machines.

## 012: Choose the router by platform

Status: accepted (replaces 004)

Context: Decision 004 said "BrowserRouter and HashRouter" but did not say where to use which. In Electron, `BrowserRouter` does not work, because the packaged app opens `file://` URLs and no server rewrites the paths. On the web, `HashRouter` gives URLs like `/#/merge`. These are not nice for sharing and not good for search engines.

Decision: The web build uses `BrowserRouter`. The Electron and Capacitor builds use `HashRouter`. We make this choice in one place inside `src/platform/` (for example an `AppRouter` component). Tools and pages just use normal React Router links and routes. The choice is made at build time, not while the app runs. The Vite `base` setting follows the same choice: `/` for web and `./` for packaged apps.

Consequences: The web gets clean URLs, and the desktop and Android apps have working routes. No platform check is needed outside `platform/`. The web host must serve `index.html` for unknown paths. GitHub Pages needs a `404.html` copy, and Netlify and Cloudflare Pages need a rewrite rule. Clean URLs alone do not give good SEO. We also need a title and description for each page, and maybe pre-rendering of the main pages. We will decide this when the first tools are ready. We now have two build modes (web and packaged), so the Electron and Capacitor scripts must use the packaged one.

## 013: First release is a PDF viewer

Status: accepted

Context: The desktop and Android shells are ready (packaging and icons), but no tool exists yet. The first tools (merge and others) need shared parts first: tool types, the registry, the worker hook and the app shell. That takes time. We want something useful to release early, so we can test installers, file opening, signing and the release steps on real devices.

Decision: The first release is a simple PDF viewer for the desktop and Android apps (the web gets it from the same code). A user can open a PDF from the operating system or a file picker, read it, move between pages and zoom. No editing. Tools are built after that, in separate PRs.

Consequences: We test the whole path from shell to screen early, and users have a reason to install. Tool work can run in parallel once the viewer lands. A viewer is not our main promise (PDF tools), so release notes must say clearly what is included and what is coming. We add `pdfjs-dist` before any tool exists (see [Dependencies](dependencies.md)).

## 014: The viewer lives in `src/viewer/`

Status: accepted

Context: The viewer is a screen, not a tool: it makes no output file and is not in the registry. It draws pages on a canvas with `pdfjs-dist`, which needs the DOM, so it cannot go in `core` (decision 001 and the rules in [Architecture](architecture.md) keep `core` free of the DOM). `src/pages/` is only for screens without PDF code (decision 008).

Decision: The viewer gets its own folder, `src/viewer/`, with its page, the plain code that talks to `pdfjs-dist`, and viewer-only components. Its route is added in `App.tsx` directly, not from the registry. The PDF.js worker is bundled locally. The viewer does not import tools, and tools do not import the viewer. If a tool later needs page previews, we move the shared drawing code to `components/` or `hooks/`, the lowest folder both can import from.

Consequences: One place to look for everything about the viewer. It is the one folder where PDF-related code may use the canvas. Rule 4 still holds: drawing code stays in plain `.ts` files, not inside React components. Reviewers need to watch this by hand for now (see decision 007).
