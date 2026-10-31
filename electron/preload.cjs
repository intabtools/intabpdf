const { contextBridge, ipcRenderer } = require('electron');
// Preload state lives for the lifetime of one page load, so it resets
// automatically whenever the renderer reloads.
const listeners = new Set();
const backlog = [];
const errorListeners = new Set();
const errorBacklog = [];
const startListeners = new Set();
const startBacklog = [];
let announcedReady = false;

// Single IPC subscriptions, registered once. If no React listener is
// attached at the moment an event arrives (e.g. between a StrictMode
// unsubscribe and resubscribe), events are buffered instead of lost.
ipcRenderer.on('open-pdf', (_event, file) => {
  if (listeners.size === 0) {
    backlog.push(file);
    return;
  }
  for (const listener of [...listeners]) {
    try {
      listener(file);
    } catch (error) {
      console.error('onOpenPdf listener threw:', error);
    }
  }
});

ipcRenderer.on('open-pdf-error', (_event, errorData) => {
  if (errorListeners.size === 0) {
    errorBacklog.push(errorData);
    return;
  }
  for (const listener of [...errorListeners]) {
    try {
      listener(errorData);
    } catch (error) {
      console.error('onOpenPdfError listener threw:', error);
    }
  }
});

ipcRenderer.on('open-pdf-start', (_event, startData) => {
  if (startListeners.size === 0) {
    startBacklog.push(startData);
    return;
  }
  for (const listener of [...startListeners]) {
    try {
      listener(startData);
    } catch (error) {
      console.error('onOpenPdfStart listener threw:', error);
    }
  }
});

contextBridge.exposeInMainWorld('intab', {
  hasPendingPdf: () => {
    try {
      if (backlog.length > 0 || errorBacklog.length > 0) return true;
      return Boolean(ipcRenderer.sendSync('has-pending-file'));
    } catch {
      return false;
    }
  },
  clearPendingPdf: () => {
    backlog.length = 0;
    errorBacklog.length = 0;
    startBacklog.length = 0;
    try {
      ipcRenderer.send('clear-pending-file');
    } catch {
      // ignore
    }
  },
  onOpenPdf: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onOpenPdf expects a callback function');
    }
    // Wrap so the same callback can be subscribed more than once and each
    // unsubscribe only removes its own registration.
    const listener = (file) => callback(file);
    listeners.add(listener);
    // Deliver anything that arrived while nobody was listening.
    while (backlog.length > 0) {
      listener(backlog.shift());
    }
    // Announce readiness only once per page load, after a listener exists.
    if (!announcedReady) {
      announcedReady = true;
      ipcRenderer.send('renderer-ready');
    }
    // Return an unsubscribe function for React cleanup.
    return () => {
      listeners.delete(listener);
    };
  },
  onOpenPdfError: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onOpenPdfError expects a callback function');
    }
    const listener = (errorData) => callback(errorData);
    errorListeners.add(listener);
    while (errorBacklog.length > 0) {
      listener(errorBacklog.shift());
    }
    return () => {
      errorListeners.delete(listener);
    };
  },
  onOpenPdfStart: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onOpenPdfStart expects a callback function');
    }
    const listener = (startData) => callback(startData);
    startListeners.add(listener);
    while (startBacklog.length > 0) {
      listener(startBacklog.shift());
    }
    return () => {
      startListeners.delete(listener);
    };
  },
  openExternalUrl: (url) => {
    if (typeof url === 'string') {
      ipcRenderer.send('open-external-url', url);
    }
  },
});
