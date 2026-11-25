# InTabPDF Platforms & Shells

InTabPDF targets three distinct distribution targets from a single TypeScript + React codebase:
1. **Web App / Website** (Static site, standard browser)
2. **Desktop App** (Electron packaging for Windows and Linux; macOS deferred pending icons and signing)
3. **Android Mobile App** (Capacitor Android wrapper)

All platforms run the same compiled code from `dist/` with zero remote dependencies.

---

## 1. Platform Detection & Document Attributes

Platform detection is centralized in [src/platform/index.ts](../src/platform/index.ts) using `getPlatformType()`:

```typescript
export type PlatformType = 'web' | 'electron' | 'android';

export function getPlatformType(): PlatformType {
  if (typeof window === 'undefined') return 'web';

  // 1. URL query parameter override for automated testing (?platform=android|electron|web)
  try {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('platform');
    if (p === 'android' || p === 'electron' || p === 'web') {
      return p;
    }
  } catch {
    // Ignore
  }

  // 2. Native Capacitor Android runtime
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return 'android';
  }

  // 3. Electron desktop runtime
  if (
    window.intab !== undefined ||
    (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) ||
    import.meta.env.MODE === 'desktop'
  ) {
    return 'electron';
  }

  // 4. Default: Web browser
  return 'web';
}
```

### Document Attributes

[src/components/ShellContainer.tsx](../src/components/ShellContainer.tsx) synchronizes attributes on `<div id="root">`:
- `data-platform`: `"web"` | `"electron"` | `"android"`
- `data-shell`: `"web"` | `"app"`

This enables CSS selectors like `[data-platform="android"] .sbg` or `[data-shell="app"] .hdr` to apply scoped platform styling without JavaScript render logic.

---

## 2. Platform-Specific Scrollbar Presentation

InTabPDF implements native-feeling scrolling across all platforms via [src/styles/base.css](../src/styles/base.css), [src/styles/web.css](../src/styles/web.css), and [src/viewer/viewer.css](../src/viewer/viewer.css):

### Android / Mobile (`data-platform="android"`)
- Persistent scrollbars are completely hidden (`scrollbar-width: none; ::-webkit-scrollbar { display: none }`).
- Natural touch momentum scrolling is preserved across all containers (`-webkit-overflow-scrolling: touch; overflow-y: auto`).
- Never uses `overflow: hidden` to hide scrollbars when content needs to be reachable.

### Electron Desktop (`data-platform="electron"`)
- Scrollbars are unobtrusive and transient.
- Scrollbar tracks are transparent; thumbs are subtle 6px floating pills (`rgba(255, 255, 255, 0.2)` in dark mode, `rgba(0, 0, 0, 0.15)` in light mode) that brighten upon hover or interaction.
- Mouse-wheel, trackpad, and keyboard accessibility scrolling are preserved.

### Web Browser (`data-platform="web"`)
- Retains standard, accessible 8px scrollbar tracks with subtle borders and clear contrast so browser users can easily navigate long pages.

---

## 3. Mobile Navigation Drawer Geometry

On mobile (`android`), the navigation drawer follows specific geometry matching reference designs:
- **Status Bar Separation:** Starts below the status bar using `padding-top: var(--sat)`.
- **Full-Bleed Overlay:** Overlays the application header, page content, and bottom navigation.
- **Background Scroll Locking:** While open, `.dr .main` applies `overflow: hidden` to prevent accidental background scrolling.
- **Independent Scrolling:** The navigation list inside `.dr .sbg` scrolls independently without visible scrollbar tracks.
- **Dismissal:** Closes on scrim click, destination link click, or Android Back button press.

---

## 4. Fullscreen and Distraction-Free Modes

In the embedded PDF viewer ([src/viewer/ViewerPage.tsx](../src/viewer/ViewerPage.tsx)), full-screen reading is separated into two dedicated capabilities:

1. **Window Fullscreen (`Maximize2` / `Minimize2` button, `F` key):**
   - Invokes standard DOM `document.documentElement.requestFullscreen()` / `exitFullscreen()`.
   - Expands the window to occupy the entire physical monitor without operating system taskbars.
2. **Distraction-Free Mode (`Lock` / `LockOpen` button):**
   - Calls `setShowAppLayout(false)` to cleanly hide the application header, sidebar, bottom navigation, and status bar.
   - Preserves current scroll position, active page, and zoom factor without layout shifting.
   - Shows a transient floating exit padlock button (`Exit distraction-free mode`) that appears upon cursor movement and fades after 2.2 seconds.
   - Dismissible via clicking the padlock button, pressing `Escape`, or the Android Back button.

---

## 5. Platform PDF Viewing Strategies

To best fit the constraints and strengths of each environment, InTabPDF uses tailored viewing mechanisms:

### Web Browser
- Instead of running a duplicate PDF.js rendering instance within the browser, the web platform routes viewing directly to a new browser tab via `openPdfInNewTab` ([src/platform/webPdf.ts](../src/platform/webPdf.ts)).
- Generates a local Blob URL appended with `#filename=${encodeURIComponent(fileName)}` so the browser's native PDF engine receives the file name.
- Automatically tracks and revokes Blob URLs after 10 minutes or upon tab `beforeunload` to prevent memory leaks.
- Handles popup blocking gracefully with toast notifications and direct download fallbacks.
- The `/viewer` route is disabled on web; navigation to `/viewer` automatically redirects to `/`.
- Responsive container geometry (`.wp`, `.whi` scaling from 1120px up to 1520px at ≥ 1600px) allowing tool-card catalogs to expand across 3 to 5 columns on wide monitors.

### Electron Desktop & Capacitor Android
- Retains the full-featured, zero-latency embedded PDF viewer (`/viewer`).
- Responsive dashboard layout: expands across the full available content area after the sidebar with a comfortable 1560px ceiling on ultra-wide screens, scaling dynamically from 2 columns on mobile to 5 columns at 1650px and 6 columns on Full HD / collapsed sidebar.
- Direct page-number navigation via an editable badge input (`.vtb-page-badge`), Next/Prev page toolbar buttons, and accessible keyboard navigation (`PageUp`, `PageDown`, `Home`, `End`, `ArrowUp`, `ArrowDown`).
- Container-scroll target calculation (`scrollTop`) that bypasses compositor smooth-scroll stalls and guarantees instant, deterministic scrolling in nested scroll hierarchies.
- Centered page-proximity tracking that accurately synchronizes current page number regardless of page aspect ratio or bottom boundary scroll limits.
- Zoom controls spanning 25% to 400% with accessible zoom badge click-to-fit, dynamic Fit-to-Width, double-click on page canvas to toggle zoom/fit, and keyboard shortcuts (`Ctrl++`, `Ctrl+-`, `Ctrl+0`).
- Asynchronous fulltext search with match counts (`Searching...`, `X of Y`, `No matches`), Next/Prev navigation, keyboard shortcuts (`Ctrl+F`, `Enter`, `Shift+Enter`, `Escape`), and responsive layout adapted to narrow mobile viewports.
- Graceful Android fullscreen fallback: when `requestFullscreen()` is unsupported or throws in Capacitor WebView, automatically enters distraction-free reading mode.
- Explicit `touch-action: pan-x pan-y pinch-zoom` for fluid mobile scrolling and touch manipulation.
- Quick document close action returning immediately to the empty drop-zone state and thoroughly clearing memory and references.
- Touch-friendly floating pager and thumbnail drawer on mobile viewports.

---

## 6. File Saving & Sharing Strategies

File saving across platforms is coordinated through `platform.saveFile()` in [src/platform/index.ts](../src/platform/index.ts):

### Android Mobile (Capacitor)
- **Chunked Base64 Encoding:** High-resolution or multi-page PDFs can reach tens of megabytes. To prevent memory bottlenecks and call-stack limits, byte streams are encoded using 32 KB chunked buffers (`uint8ArrayToBase64`).
- **Direct Documents Persistence (`src/platform/androidSave.ts`):** Checks for existing filename collisions in `Directory.Documents` (prompting Replace, Rename, or Cancel) and writes files directly to `Directory.Documents` via `@capacitor/filesystem`.
- **System Share Sheet Integration:** Mirrors the saved file to `Directory.Cache` so Android's FileProvider can pass a content URI to `@capacitor/share`. Users can immediately save to external storage, send via email, or open in another viewer; cache-mirroring or Share sheet errors are logged without aborting the Documents save.
- **Error Handling:** Native `Directory.Documents` write errors or missing conflict-dialog handlers are thrown to the caller rather than falling back to an HTML5 anchor download.

### Web Browser & Electron Desktop
- Generates an in-memory `Blob` matching the file's MIME type.
- Creates an invisible DOM `<a>` tag with the `download` attribute set to the sanitized filename.
- Programmatically triggers the download and schedules `URL.revokeObjectURL()` cleanup after 1 second (`1000` ms) to prevent browser memory leaks.

---

## 7. Build Commands

```bash
# Web development server
npm run dev

# Web production build (outputs to dist/)
npm run build

# Electron desktop build (outputs to dist/ with base: './')
npm run build:desktop

# Package desktop installers (Linux/Windows)
npm run dist
npm run dist:win
npm run dist:linux

# Android asset synchronization (builds web assets and syncs to android/app/src/main/assets/public/)
npm run sync:android

# Android native Java compilation & debug APK packaging
npm run android:build
# (or: cd android && ./gradlew assembleDebug)

# Run Vitest unit/integration tests
npm test

# Run Playwright E2E browser tests
npm run test:e2e
```

### Android Asset Synchronization & Engine Guard
- **Pre-Packaging Verification:** The Android build enforces asset freshness via a custom Gradle task `checkWebAssets` in `android/app/build.gradle`. If `android/app/src/main/assets/public/index.html` is missing or out-of-sync, the Gradle task immediately fails compilation, directing developers to run `npm run sync:android`.
- **Node.js Compatibility:** `@capacitor/cli` v8 declares a Node >= 22 engine requirement. InTabPDF provides `scripts/cap.cjs` (`npm run cap`) to allow developers on Node 20 LTS to build and synchronize assets without false-positive engine errors.

---

## 8. Web Deployment & Hosting (Cloudflare Pages)

The web edition of InTabPDF is deployed as a static client-side application via Cloudflare Pages connected to the GitHub repository.

### Cloudflare Pages Configuration

- **Connected Repository:** `https://github.com/intabtools/intabpdf`
- **Production Branch:** `main` (auto-deploys on push; pull requests receive isolated preview deployments)
- **Framework Preset:** `None` (or `Vite`)
- **Build Command:** `npm run build` (`tsc -b && vite build`)
- **Build Output Directory:** `dist`
- **Environment Variables:**
  - `NODE_VERSION`: `20` (Node.js 18+ or 20+ LTS required)

### HTTP Headers & Content Security Policy (CSP)

Cloudflare Pages enforces security headers via [public/_headers](../public/_headers):
- `Content-Security-Policy`: Restricts scripts to `'self'` and `'wasm-unsafe-eval'`; styles to `'self' 'unsafe-inline'`; workers to `'self' blob:`; and explicitly disables plugins (`object-src 'none'`) and frame embedding (`frame-ancestors 'none'`).
- `Permissions-Policy`: Restricts browser hardware access (`camera=(), microphone=(), geolocation=()`).
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

### SPA Routing & Redirects

Because InTabPDF uses HTML5 History API (`BrowserRouter`) on the web platform, direct browser visits or crawler requests to deep URLs (e.g. `/tool/merge` or `/about`) must serve `index.html`.
The static rewrite rule is managed via [public/_redirects](../public/_redirects):

```
/* /index.html 200
```

Vite automatically copies this file to `dist/_redirects` during `npm run build`.

### Deployment URLs & Custom Domains

1. **Free `pages.dev` Subdomain:**
   Cloudflare Pages automatically assigns `<project-name>.pages.dev` (e.g. `https://intabpdf.pages.dev`).
2. **Custom Domain:**
   Custom domains (e.g. `https://intabpdf.com`) can be configured at any time under **Cloudflare Pages Dashboard → Project Settings → Custom Domains**. Cloudflare manages SSL/TLS certificates and global CDN edge routing automatically.
3. **Production URL & Sitemap Updates:**
   Once the canonical production domain is assigned:
   - Update the base URL `<loc>` entries in [public/sitemap.xml](../public/sitemap.xml).
   - Uncomment the `Sitemap:` reference in [public/robots.txt](../public/robots.txt).
   - Add `<link rel="canonical" href="https://<your-domain>/" />` to `index.html`.

### Deployment Verification & Troubleshooting

- **Verification:**
  1. Navigate to the deployment URL (`https://<project>.pages.dev`).
  2. Verify that homepage tools, the about page (`/about`), and direct tool links (`/tool/merge`, `/tool/compress`) load with HTTP 200 on hard refresh.
  3. Verify that `/robots.txt`, `/sitemap.xml`, and `/favicon.svg` are reachable.
  4. Open the browser DevTools Network tab, upload or process a sample PDF, and confirm **zero outbound network requests** are made with document data.
- **Troubleshooting Failed Builds:**
  - *TypeScript Errors (`tsc -b`):* Run `npm run build` locally to identify type mismatch errors before pushing.
  - *Node Version Warning:* Ensure `NODE_VERSION: 20` is configured in Cloudflare Pages environment variables.
  - *Missing Assets / 404 on Refresh:* Ensure `public/_redirects` is in place with `/* /index.html 200`.

### Available Tools in 2.0.0

All 13 client-side PDF tools are available across Web, Desktop (Electron), and Android:

| Category | Tools |
|---|---|
| **Create** | **Images to PDF** (`/tool/images-to-pdf`), **Text to PDF** (`/tool/text-to-pdf`) |
| **Organize** | **Merge** (`/tool/merge`), **Split** (`/tool/split`), **Reorder pages** (`/tool/reorder`), **Rotate pages** (`/tool/rotate`), **Remove pages** (`/tool/remove-pages`) |
| **Shrink and secure** | **Compress** (`/tool/compress`), **Protect** (`/tool/protect`), **Unlock** (`/tool/unlock`) |
| **Sign and convert** | **Sign** (`/tool/sign`), **PDF to images** (`/tool/pdf-to-images`), **Extract text** (`/tool/extract-text`) |
