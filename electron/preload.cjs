const { contextBridge, ipcRenderer } = require('electron');
// Preload state lives for the lifetime of one page load, so it resets
// automatically whenever the renderer reloads.
const listeners = new Set();
const backlog = [];
let announcedReady = false;
// Single IPC subscription, registered once. If no React listener is
// attached at the moment a file arrives (e.g. between a StrictMode
// unsubscribe and resubscribe), the file is buffered instead of lost.
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

contextBridge.exposeInMainWorld('intab', {
  hasPendingPdf: () => {
    try {
      if (backlog.length > 0) return true;
      return Boolean(ipcRenderer.sendSync('has-pending-file'));
    } catch {
      return false;
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
  openExternalUrl: (url) => {
    if (typeof url === 'string') {
      ipcRenderer.send('open-external-url', url);
    }
  },
});
