const ALLOWED_CLIPBOARD_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'clipboard-read',
]);

/**
 * Allows only strictly scoped clipboard permissions for verified application origins.
 * Unrelated permissions (camera, mic, geolocation, notifications, etc.) and untrusted
 * origins are always denied.
 */
function isAllowedPermission(permission, originUrl, isAllowedOrigin) {
  if (!ALLOWED_CLIPBOARD_PERMISSIONS.has(permission)) {
    return false;
  }
  if (typeof isAllowedOrigin !== 'function' || typeof originUrl !== 'string' || !originUrl) {
    return false;
  }
  return Boolean(isAllowedOrigin(originUrl));
}

/**
 * Determines whether the current renderer URL corresponds to the PDF viewer route
 * across both BrowserRouter (/viewer) and packaged HashRouter (#/viewer) builds.
 */
function isViewerUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname === '/viewer' || parsed.pathname.startsWith('/viewer/')) {
      return true;
    }
    return (
      parsed.hash === '#/viewer' ||
      parsed.hash.startsWith('#/viewer?') ||
      parsed.hash.startsWith('#/viewer/')
    );
  } catch {
    return false;
  }
}

/**
 * Builds an Electron context-menu template for editable inputs, viewer pages, or non-viewer routes.
 */
function buildContextMenuTemplate({
  selectionText = '',
  isEditable = false,
  isViewerRoute = false,
  viewerCopyAllowed = true,
  onCopy,
  onSelectAll,
}) {
  const hasSelection = typeof selectionText === 'string' && selectionText.trim().length > 0;

  if (isEditable) {
    return [
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' },
    ];
  }

  const items = [];
  if (isViewerRoute && !viewerCopyAllowed) {
    items.push({
      label: 'Copy disabled by PDF permissions',
      enabled: false,
    });
    return items;
  }

  items.push({
    label: 'Copy',
    enabled: hasSelection,
    click: () => {
      if (hasSelection && typeof onCopy === 'function') {
        onCopy(selectionText);
      }
    },
  });

  if (isViewerRoute) {
    items.push({
      label: 'Select All on Page',
      enabled: true,
      click: () => {
        if (typeof onSelectAll === 'function') {
          onSelectAll();
        }
      },
    });
  } else {
    items.push({ role: 'selectAll' });
  }

  return items;
}

module.exports = {
  ALLOWED_CLIPBOARD_PERMISSIONS,
  isAllowedPermission,
  isViewerUrl,
  buildContextMenuTemplate,
};
