const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
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
const { resolvePdfArg, findPdf } = require('./args.cjs');

// Queue an incoming PDF until the frontend is ready.
function queuePdf(filePath) {
  if (!filePath) return;
  const resolved = resolvePdfArg(filePath) || path.resolve(filePath);
  if (!pendingFiles.includes(resolved)) {
    pendingFiles.push(resolved);
  }
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
      const fileName = path.basename(filePath);
      try {
        win.webContents.send('open-pdf-start', { name: fileName });

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
          name: fileName,
          bytes,
        });
      } catch (error) {
        pendingFiles.shift();
        console.error(`Could not open PDF: ${filePath}`, error);
        if (win && !win.isDestroyed()) {
          let userError =
            'Could not open this PDF. Check whether the file is damaged, unsupported, or accessible.';
          if (error && error.code === 'ENOENT') {
            userError =
              'Could not find this PDF file. It may have been moved, renamed, or deleted.';
          } else if (error && error.code === 'EACCES') {
            userError =
              'Permission denied while trying to access this PDF file.';
          } else if (
            error &&
            error.message &&
            error.message.includes('File too large')
          ) {
            userError = `This PDF exceeds the maximum file size limit (${Math.round(
              MAX_PDF_BYTES / (1024 * 1024),
            )} MB).`;
          } else if (
            error &&
            error.message &&
            error.message.includes('Not a regular file')
          ) {
            userError =
              'The selected path is a folder or special file, not a standard PDF document.';
          }
          win.webContents.send('open-pdf-error', {
            name: fileName,
            error: userError,
          });
        }
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
const CANONICAL_REPO_PATH = '/intabtools/intabpdf';

// External link check: restrict external browser opening strictly to the
// canonical GitHub repository and its issues/releases.
function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
      return false;
    }
    return (
      parsed.pathname === CANONICAL_REPO_PATH ||
      parsed.pathname.startsWith(`${CANONICAL_REPO_PATH}/`)
    );
  } catch {
    return false;
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
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'InTabPDF',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.removeMenu();
  win.setTitle('InTabPDF');
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  const wc = win.webContents;
  // Reset readiness only when the top-level page reloads or navigates away.
  // Do NOT listen to 'did-start-loading' because it fires for sub-resources and lazy chunks.
  wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      rendererReady = false;
    }
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
  // Do not allow pages to create arbitrary new windows. Only open the trusted
  // canonical repository externally in the system's default browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch((err) => {
        console.error('Failed to open external URL:', err);
      });
    }
    return { action: 'deny' };
  });
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
  if (initialPdf && !pendingFiles.includes(initialPdf)) {
    pendingFiles.push(initialPdf);
  }
  app.on('second-instance', (_event, argv) => {
    const file = findPdf(argv);
    if (file) queuePdf(file);

    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  ipcMain.on('has-pending-file', (event) => {
    if (!win || win.isDestroyed()) {
      event.returnValue = false;
      return;
    }
    if (event.sender !== win.webContents) {
      event.returnValue = false;
      return;
    }
    event.returnValue = pendingFiles.length > 0;
  });
  ipcMain.on('clear-pending-file', (event) => {
    if (!win || win.isDestroyed()) return;
    if (event.sender !== win.webContents) return;
    pendingFiles.length = 0;
  });

  // Safely open the canonical repository externally via IPC from our trusted main frame.
  ipcMain.on('open-external-url', (event, rawUrl) => {
    if (!win || win.isDestroyed()) return;
    if (event.sender !== win.webContents) return;
    const frame = event.senderFrame;
    if (!frame || frame !== win.webContents.mainFrame) return;
    if (!isAllowedNavigation(frame.url)) return;
    if (typeof rawUrl === 'string' && isAllowedExternalUrl(rawUrl)) {
      shell.openExternal(rawUrl).catch((err) => {
        console.error('Failed to open external URL:', err);
      });
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
