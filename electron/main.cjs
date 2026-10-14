const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const fs = require('fs');

const isDev = process.argv.includes('--dev');
// INTAB_TEST_DIST lets the automated tests load a fixture page instead of the
// real frontend. It is ignored in packaged builds.
const frontendDir =
  !app.isPackaged && process.env.INTAB_TEST_DIST
    ? path.resolve(process.env.INTAB_TEST_DIST)
    : path.resolve(__dirname, '../dist');

// Refuse to load absurdly large files into memory / over IPC.
const MAX_PDF_BYTES = 200 * 1024 * 1024; // 200 MB

let win = null;
let rendererReady = false;
let drainingQueue = false;
const pendingFiles = [];

// argv[0] is the executable itself, so skip it.
const findPdf = (argv) =>
  argv
    .slice(1)
    .find(
      (arg) =>
        typeof arg === 'string' &&
        !arg.startsWith('--') &&
        arg.toLowerCase().endsWith('.pdf'),
    ) || null;
// Queue an incoming PDF until the frontend is ready.
function queuePdf(filePath) {
  if (!filePath) return;
  pendingFiles.push(path.resolve(filePath));
  flushPendingFiles().catch((error) => {
    console.error('Failed to process pending PDFs:', error);
  });
}

// Deliver queued PDFs in order.
async function flushPendingFiles() {
  if (drainingQueue || !rendererReady || !win || win.isDestroyed()) {
    return;
  }
  drainingQueue = true;
  try {
    while (
      rendererReady &&
      pendingFiles.length > 0 &&
      win &&
      !win.isDestroyed()
    ) {
      const filePath = pendingFiles[0];
      try {
        const stats = await fs.promises.stat(filePath);

        if (!stats.isFile()) {
          throw new Error('Not a regular file');
        }
        if (stats.size > MAX_PDF_BYTES) {
          throw new Error(
            `File too large (${stats.size} bytes, limit ${MAX_PDF_BYTES})`,
          );
        }

        const bytes = await fs.promises.readFile(filePath);

        // The renderer may have reloaded while the file was being read.
        if (!rendererReady || !win || win.isDestroyed()) {
          break;
        }
        pendingFiles.shift();
        win.webContents.send('open-pdf', {
          name: path.basename(filePath),
          bytes,
        });
      } catch (error) {
        pendingFiles.shift();
        console.error(`Could not open PDF: ${filePath}`, error);
      }
    }
  } finally {
    drainingQueue = false;
    // Resume if new files arrived while the queue was being processed.
    if (rendererReady && pendingFiles.length > 0) {
      queueMicrotask(() => {
        flushPendingFiles().catch(console.error);
      });
    }
  }
}
// Navigation / IPC origin check: only the packaged frontend, or the local
// Vite dev server. blob: and data: are NOT acceptable here.
function isAllowedNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (isDev) {
      return (
        (url.protocol === 'http:' || url.protocol === 'ws:') &&
        url.hostname === 'localhost' &&
        url.port === '5173'
      );
    }
    if (url.protocol !== 'file:') return false;
    const requestedPath = path.resolve(fileURLToPath(url));
    const relativePath = path.relative(frontendDir, requestedPath);
    return (
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    );
  } catch {
    return false;
  }
}

// Network request check: same as above, plus blob:/data: which pdf.js and
// rendering need for workers, canvases and images.
function isAllowedRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'blob:' || url.protocol === 'data:') return true;
  } catch {
    return false;
  }
  return isAllowedNavigation(rawUrl);
}
function configureSessionSecurity() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url) });
  });
  // Deny every permission request (camera, mic, notifications, etc.).
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
}

function createWindow() {
  rendererReady = false;

  win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const wc = win.webContents;
  // Reset readiness if the frontend reloads.
  wc.on('did-start-loading', () => {
    rendererReady = false;
  });
  // If the renderer crashes, reset readiness and reload so queued files
  // can be delivered again.
  wc.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason);
    rendererReady = false;
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) {
      win.reload();
    }
  });
  // Prevent navigation away from the trusted application.
  wc.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  wc.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  // Never allow <webview> tags.
  wc.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  // Do not allow pages to create arbitrary new windows.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(frontendDir, 'index.html'));
  }
}
// Ensure only one app instance handles PDF-open requests.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Capture a PDF passed when the app is launched.
  const initialPdf = findPdf(process.argv);
  if (initialPdf) pendingFiles.push(path.resolve(initialPdf));
  app.on('second-instance', (_event, argv) => {
    const file = findPdf(argv);
    if (file) queuePdf(file);

    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // Only accept readiness messages from our own renderer's main frame,
  // loaded from an allowed origin.
  ipcMain.on('renderer-ready', (event) => {
    if (!win || win.isDestroyed()) return;
    if (event.sender !== win.webContents) return;
    const frame = event.senderFrame;
    if (!frame || frame !== win.webContents.mainFrame) return;
    if (!isAllowedNavigation(frame.url)) return;
    rendererReady = true;
    flushPendingFiles().catch(console.error);
  });
  app.whenReady().then(() => {
    configureSessionSecurity();
    createWindow();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
