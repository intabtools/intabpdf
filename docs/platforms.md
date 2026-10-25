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

## 4. Temporary Full-Screen PDF Mode

In the PDF viewer ([src/viewer/ViewerPage.tsx](file:///home/ayusman/Desktop/intabpdf/src/viewer/ViewerPage.tsx)), users can toggle full-screen reading mode:
- Clicking the `Maximize2` / `Minimize2` button in the toolbar invokes `setShowAppLayout(false)`.
- [src/components/AppShell.tsx](file:///home/ayusman/Desktop/intabpdf/src/components/AppShell.tsx) and [src/components/WebShell.tsx](file:///home/ayusman/Desktop/intabpdf/src/components/WebShell.tsx) hide the outer application header, sidebar, navigation rail, and bottom nav.
- Pressing `Escape` or the Android Back button restores `showAppLayout: true` immediately.

---

## 5. Build Commands

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
