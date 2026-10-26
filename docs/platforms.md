# InTabPDF Platforms & Shells

InTabPDF targets three distinct distribution targets from a single TypeScript + React codebase:
1. **Web App / Website** (Static site, standard browser)
2. **Desktop App** (Electron packaging for Windows, macOS, Linux)
3. **Android Mobile App** (Capacitor Android wrapper)

All platforms run the same compiled code from `dist/` with zero remote dependencies.

---

## 1. Platform Detection & Document Attributes

Platform detection is centralized in [src/platform/index.ts](file:///home/ayusman/Desktop/intabpdf/src/platform/index.ts) using `getPlatformType()`:

```typescript
export type PlatformType = 'web' | 'electron' | 'android';

export function getPlatformType(): PlatformType {
  // 1. Electron: window.electronAPI injected via preload script
  if (typeof window !== 'undefined' && 'electronAPI' in window) {
    return 'electron';
  }
  // 2. Capacitor Android: window.Capacitor isNativePlatform() === true
  if (
    typeof window !== 'undefined' &&
    'Capacitor' in window &&
    (window as any).Capacitor?.isNativePlatform?.()
  ) {
    return 'android';
  }
  // 3. Fallback: Web browser
  return 'web';
}
```

### Document Attributes

[src/components/ShellContainer.tsx](file:///home/ayusman/Desktop/intabpdf/src/components/ShellContainer.tsx) synchronizes attributes on `<div id="root">`:
- `data-platform`: `"web"` | `"electron"` | `"android"`
- `data-shell`: `"web"` | `"app"`

This enables CSS selectors like `[data-platform="android"] .sbg` or `[data-shell="app"] .hdr` to apply scoped platform styling without JavaScript render logic.

---

## 2. Platform-Specific Scrollbar Presentation

InTabPDF implements native-feeling scrolling across all platforms via [src/styles/base.css](file:///home/ayusman/Desktop/intabpdf/src/styles/base.css), [src/styles/web.css](file:///home/ayusman/Desktop/intabpdf/src/styles/web.css), and [src/viewer/viewer.css](file:///home/ayusman/Desktop/intabpdf/src/viewer/viewer.css):

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

In the embedded PDF viewer ([src/viewer/ViewerPage.tsx](file:///home/ayusman/Desktop/intabpdf/src/viewer/ViewerPage.tsx)), full-screen reading is separated into two dedicated capabilities:

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
- Instead of running a duplicate PDF.js rendering instance within the browser, the web platform routes viewing directly to a new browser tab via `openPdfInNewTab` ([src/platform/webPdf.ts](file:///home/ayusman/Desktop/intabpdf/src/platform/webPdf.ts)).
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

File saving across platforms is coordinated through `platform.saveFile()` in [src/platform/index.ts](file:///home/ayusman/Desktop/intabpdf/src/platform/index.ts):

### Android Mobile (Capacitor)
- **Chunked Base64 Encoding:** High-resolution or multi-page PDFs can reach tens of megabytes. To prevent memory bottlenecks and call-stack limits, byte streams are encoded using 32 KB chunked buffers (`uint8ArrayToBase64`).
- **Direct Documents Persistence:** Files are written directly to `Directory.Documents` via the Capacitor Filesystem plugin.
- **System Share Sheet Integration:** The file is mirrored to `Directory.Cache`, allowing Android's FileProvider to pass a content URI to `@capacitor/share`. Users can immediately save to Google Drive, send via email, or open in another viewer.
- **Fail-Safe Fallback:** If native file system or sharing operations encounter restrictions, the adapter automatically falls back to an HTML5 anchor download.

### Web Browser & Electron Desktop
- Generates an in-memory `Blob` matching the file's MIME type.
- Creates an invisible DOM `<a>` tag with the `download` attribute set to the sanitized filename.
- Programmatically triggers the download and schedules `URL.revokeObjectURL()` cleanup after 5 seconds to prevent browser memory leaks.

---

## 7. Build Commands

```bash
# Web development server
npm run dev

# Web production build (outputs to dist/)
npm run build

# Electron desktop build (outputs to dist/ with base: './')
npm run build:desktop

# Package desktop installer (Linux/Windows)
npm run dist

# Android native Java compilation
cd android && ./gradlew compileDebugJavaWithJavac
```

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

### SPA Routing & Redirects

Because InTabPDF uses HTML5 History API (`BrowserRouter`) on the web platform, direct browser visits or crawler requests to deep URLs (e.g. `/tool/merge` or `/about`) must serve `index.html`.
The static rewrite rule is managed via [public/_redirects](file:///home/ayusman/Desktop/intabpdf/public/_redirects):

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
   - Update the base URL `<loc>` entries in [public/sitemap.xml](file:///home/ayusman/Desktop/intabpdf/public/sitemap.xml).
   - Uncomment the `Sitemap:` reference in [public/robots.txt](file:///home/ayusman/Desktop/intabpdf/public/robots.txt).
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

### Implemented Tools vs. Coming Soon Status

The web production deployment includes 6 fully implemented, client-side tools and 7 tools marked "Coming soon":

| Implemented (Live) | Coming Soon (Guarded & Redirects to Home) |
|---|---|
| **Merge** (`/tool/merge`) | **Text to PDF** (`/tool/text-to-pdf`) |
| **Split** (`/tool/split`) | **Reorder pages** (`/tool/reorder`) |
| **Compress** (`/tool/compress`) | **Protect** (`/tool/protect`) |
| **Rotate pages** (`/tool/rotate`) | **Unlock** (`/tool/unlock`) |
| **Remove pages** (`/tool/remove-pages`) | **Sign** (`/tool/sign`) |
| **Images to PDF** (`/tool/images-to-pdf`) | **PDF to images** (`/tool/pdf-to-images`) |
| | **Extract text** (`/tool/extract-text`) |
