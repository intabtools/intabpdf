# Architecture

This page explains how we plan to arrange the code. It is a plan to keep things simple as the project grows, not a strict law. If you feel something should change, please open an issue and tell us.

InTab PDF runs fully on the user's device. There is no server, no database and no login. All the PDF work happens in the browser, or inside the Electron desktop app and the Capacitor Android app (the Android shell is ready, and the first build is next).

## What we want from this code

Every rule on this page comes from four goals.

| Goal | What it means for us |
|---|---|
| Simple | Choose the plain way. No clever tricks and no extra layers. A new student should understand a file in a few minutes. |
| Modular | One tool lives in one folder. Tools do not depend on each other. Shared things go to `core`, `components` or `hooks`. |
| Explainable | You can say what a file does, and why it is there, in one or two sentences. Names are clear and comments explain the why. |
| Maintainable | PRs are small, `core` has tests, and docs are updated along with the code. Anyone in the group can take over any part. |

The project is at a very early stage, so please do not build for the future. Build only what is needed now, and keep it simple. When a real need comes, we will improve it together.

## The big picture

```mermaid
flowchart TD
    Pages["pages (home, donate, about)"] --> Components["components (shared UI)"]
    Pages --> Registry["tools/registry"]
    Tools["tools (one folder per tool)"] --> Components
    Tools --> Hooks["hooks (shared React hooks)"]
    Tools --> Platform["platform (open, save, share)"]
    Tools --> Workers["tool workers"]
    Workers --> Core["core (PDF logic)"]
    Viewer["viewer (PDF viewer screen)"] --> Components
    Viewer --> Platform
```

The arrows show who can use whom. Code flows in **one direction only**. `core` sits at the bottom and knows nothing about the rest of the app. `pages` are the non-tool screens: they may use `components` and read the tool list, but they never contain PDF logic.

## How one job flows

This is what happens when a user merges two PDFs.

```mermaid
sequenceDiagram
    participant U as User
    participant P as Tool page
    participant A as Platform adapter
    participant W as Web Worker
    participant C as core

    U->>P: Selects files
    P->>A: pickFiles()
    A-->>P: File list
    P->>W: postMessage (file bytes)
    W->>C: merge(bytes)
    C-->>W: Result bytes
    W-->>P: postMessage (result)
    P->>A: saveFile(result)
    A-->>U: File saved on device
```

The page never does PDF work itself. The worker does it, and the worker only calls `core`.

## The simple rules

These few rules keep the project easy to work on when many people join. Each one has a reason, so they are easy to remember.

1. **`core` imports nothing from the rest of the app.** This way we can test it easily and reuse it anywhere.
2. **`core` has no platform checks and no file paths.** Bytes in, bytes out.
3. **Platform-specific code lives only in `platform/`** and the native shells.
4. **PDF logic never lives inside a React component.**
5. **One tool does not import another tool.** If two tools need the same code, move it to `core`, `components` or `hooks`.
6. **Web uses `BrowserRouter`, packaged apps use `HashRouter`.** Clean URLs are better for web indexing and SEO. Electron and Capacitor load files from the device, and there is no server to rewrite URLs, so they need `HashRouter`. We make this choice in one place, `platform/`, and tools never know which router is used (see [decision 012](decisions.md)).
7. **No native PDF code in the Electron main process or in Kotlin.** One TypeScript version keeps all platforms the same.

Later, when the project is bigger, we may add ESLint rules so that mistakes with rules 1, 2 and 5 are caught automatically. See [Code quality](code-quality.md).

## Web Workers

Heavy work runs in a Web Worker, so the screen does not freeze on big PDFs or slow phones.

- The worker file (`<tool>.worker.ts`) lives **inside its tool folder** (`src/tools/<name>/`). There is no global `src/workers/` folder. It is a thin wrapper: it receives a message, calls the `core` function and sends back the result.
- The shared message types live in `src/tools/types.ts`, and the shared `useWorker` hook lives in `src/hooks/`.
- Send `ArrayBuffer`s as **transferable** objects. This avoids copying big files in memory.
- Try to use the same message shape in every tool, so shared hooks can work with any worker.

```ts
// An idea for the message shape. We will change it when the first tool is built.
type WorkerRequest<T> = { id: string; payload: T };

type WorkerResponse<R> =
  | { id: string; ok: true; result: R }
  | { id: string; ok: false; error: string };

// For long jobs you can also send: { id: string; progress: number }
```

## The viewer

The PDF viewer is a screen, not a tool. It opens one PDF and shows it. It lives in its own folder, `src/viewer/`, and is not in the tool registry (see [decision 014](decisions.md)).

- It draws pages onto a canvas with `pdfjs-dist`. Canvas needs the DOM, so this code cannot be in `core`.
- Rule 4 still holds: the drawing code lives in plain `.ts` files in `src/viewer/`, not inside the React component.
- It gets files only through the platform adapter, so it works the same on web, Electron and Capacitor.
- The PDF.js worker file is bundled with the app. Nothing loads from a CDN.

## Platform adapter

`platform/` hides the difference between browser, Electron and Capacitor. Tools only talk to this interface and never check which platform they are on.

```ts
// src/platform/types.ts (an idea, not final)
export interface PlatformAdapter {
  pickFiles(opts: { accept: string[]; multiple: boolean }): Promise<File[]>;
  saveFile(bytes: Uint8Array, suggestedName: string): Promise<void>;
  share?(bytes: Uint8Array, name: string): Promise<void>;
  // Called when the operating system opens a PDF with our app (desktop and Android).
  // Returns a function that stops listening.
  onFileOpened?(handler: (file: { name: string; bytes: Uint8Array }) => void): () => void;
}
```

`platform/index.ts` finds out where the app is running and gives the right version.

## Native shells

The desktop app is a thin Electron shell around the same web build.

- `electron/main.cjs` is the **main process**. It makes the window, handles app start and quit, and reads the PDF files that the operating system gives to the app.
- `electron/preload.cjs` is the **preload script**. It is the only bridge between the main process and the React code. It gives the screen only the few functions it needs.
- `src/platform/electron.ts` is the only React-side file that talks to this bridge.

The main process does only window and file work. **No PDF logic lives there.** Tools never talk to Electron directly. They use the platform adapter. See [Platforms](platforms.md) for the full desktop flow.

The Android app is a Capacitor shell around the same web build. `android/` holds only native config and the small code that receives a PDF from Android and passes its bytes to the screen. **No PDF logic lives in Kotlin or Java.** `src/platform/capacitor.ts` is the only React-side file that talks to Capacitor.

## Tool registry

`tools/registry.ts` is the one list of tools. The home grid (`pages/HomePage.tsx`) and the routes in `App.tsx` are both made from it, so adding a new tool never needs a change in the router or the home page.

```mermaid
flowchart LR
    T1["tools/merge"] --> R["registry.ts"]
    T2["tools/split"] --> R
    T3["tools/compress"] --> R
    R --> Home["Home grid"]
    R --> Routes["Routes"]
```

## Words used in these docs

| Word | Simple meaning |
|---|---|
| Web Worker | A background thread in the browser. Heavy work runs here so the screen does not hang. |
| Bundle | The final JavaScript files that Vite builds for the app. |
| Lazy loading | Loading a page or library only when the user opens it. We use dynamic `import()` for this. |
| Adapter | A small layer that gives the same functions on different platforms. `platform/` is our adapter. |
| Electron | A way to make a desktop app from a web app. It comes with its own Chromium browser, so the app behaves the same on every desktop system. |
| Capacitor | A way to make an Android app from a web app. It puts our web build inside a WebView. |
| Intent filter | An Android setting that tells the system which file types an app can open, for example PDF files. |
| Main process | The Electron part that runs outside the web page. It makes the window and reads files. It lives in `electron/main.cjs`. |
| Preload script | A small script that gives the web page a safe and limited bridge to the main process. |
| IPC | Inter-process communication. The way the main process and the web page send messages to each other. |
| Registry | One list of all tools. The home screen and the routes are made from it. |
| Transferable | Moving a buffer to a worker without copying it. This saves memory. |
| CSP | Content-Security-Policy. A browser rule that blocks network requests we did not allow. |

## See also

- [Folder guide](folder-guide.md) for what goes in each folder
- [Adding a tool](adding-a-tool.md) to build a new tool
- [Decisions log](decisions.md) for the reasons behind these rules
