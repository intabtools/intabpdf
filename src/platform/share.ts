// Cross-platform sharing utilities for PDF documents and selected text across Android, Web, and Electron.
import { getPlatformType, platform, uint8ArrayToBase64 } from './index';
import { copyTextToClipboard } from './clipboard';

const SHARE_CACHE_PREFIX = '.share_tmp_';

export type ShareOutcomeStatus = 'shared' | 'copied' | 'saved-fallback' | 'canceled' | 'unsupported' | 'invalid';

export interface ShareOutcome {
  ok: boolean;
  status: ShareOutcomeStatus;
  message: string;
}

function sanitizeShareFileName(name?: string): string {
  const base = (name || 'document.pdf').replace(/[\\/]/g, '_').trim() || 'document.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function isShareCanceledError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    return (
      err.name === 'AbortError' ||
      /cancel/i.test(err.message)
    );
  }
  return /cancel/i.test(String(err));
}

async function cleanupOldShareCacheFiles(): Promise<void> {
  try {
    const { Directory, Filesystem } = await import('@capacitor/filesystem');
    const listing = await Filesystem.readdir({ path: '', directory: Directory.Cache });
    const now = Date.now();
    for (const entry of listing.files) {
      if (typeof entry.name === 'string' && entry.name.startsWith(SHARE_CACHE_PREFIX)) {
        const tsPart = entry.name.slice(SHARE_CACHE_PREFIX.length).split('_')[0];
        const ts = Number.parseInt(tsPart, 10);
        // Remove stale temp share files older than 5 minutes (or unparseable)
        if (!Number.isFinite(ts) || now - ts > 5 * 60 * 1000) {
          await Filesystem.deleteFile({ path: entry.name, directory: Directory.Cache }).catch(() => undefined);
        }
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

export async function shareSelectedText(text: string, title = 'Selected text'): Promise<ShareOutcome> {
  if (!text || text.trim().length === 0) {
    return { ok: false, status: 'invalid', message: 'No text selected to share.' };
  }

  const platformType = getPlatformType();

  if (platformType === 'android') {
    try {
      const { Share } = await import('@capacitor/share');
      const canShare = await Share.canShare().then((r) => r.value).catch(() => false);
      if (canShare) {
        await Share.share({
          title,
          text,
          dialogTitle: 'Share selected text',
        });
        return { ok: true, status: 'shared', message: 'Shared selected text' };
      }
    } catch (err) {
      if (isShareCanceledError(err)) {
        return { ok: false, status: 'canceled', message: 'Share cancelled' };
      }
      return {
        ok: false,
        status: 'unsupported',
        message: 'Could not open Android share sheet.',
      };
    }
  }

  if (platformType !== 'electron' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return { ok: true, status: 'shared', message: 'Shared selected text' };
    } catch (err) {
      if (isShareCanceledError(err)) {
        return { ok: false, status: 'canceled', message: 'Share cancelled' };
      }
    }
  }

  const copied = await copyTextToClipboard(text);
  if (copied) {
    return {
      ok: true,
      status: 'copied',
      message:
        platformType === 'electron'
          ? 'Copied text to clipboard (OS Share unavailable on desktop)'
          : 'Copied text to clipboard (browser Share unavailable)',
    };
  }

  return {
    ok: false,
    status: 'unsupported',
    message: 'Share not supported on this device',
  };
}

export async function sharePdfDocument(params: {
  fileName?: string;
  bytes?: Uint8Array | null;
}): Promise<ShareOutcome> {
  const { fileName, bytes } = params;
  if (!bytes || bytes.byteLength === 0) {
    return {
      ok: false,
      status: 'invalid',
      message: 'No active PDF document is available to share.',
    };
  }

  const safeName = sanitizeShareFileName(fileName);
  const platformType = getPlatformType();

  // 1. Android: write temp file to Capacitor Directory.Cache and share via FileProvider URI
  if (platformType === 'android') {
    await cleanupOldShareCacheFiles();
    const cacheFileName = `${SHARE_CACHE_PREFIX}${Date.now()}_${safeName}`;
    try {
      const { Directory, Filesystem } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const canShare = await Share.canShare().then((r) => r.value).catch(() => false);
      if (!canShare) {
        return { ok: false, status: 'unsupported', message: 'Android sharing is unavailable.' };
      }

      const base64Data = uint8ArrayToBase64(bytes);
      const cacheWrite = await Filesystem.writeFile({
        path: cacheFileName,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });

      try {
        await Share.share({
          title: safeName,
          url: cacheWrite.uri,
          dialogTitle: `Share ${safeName}`,
        });
        return { ok: true, status: 'shared', message: `Shared ${safeName}` };
      } finally {
        // Schedule cleanup cleanly so receiving apps can finish reading the FileProvider URI
        setTimeout(() => {
          void Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => undefined);
        }, 15_000);
      }
    } catch (err) {
      if (isShareCanceledError(err)) {
        return { ok: false, status: 'canceled', message: 'Share cancelled' };
      }
      return {
        ok: false,
        status: 'unsupported',
        message: 'Could not share PDF on this device.',
      };
    }
  }

  // 2. Web: use Web Share API Level 2 (files) when supported, otherwise fall back to download
  if (platformType === 'web') {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof File !== 'undefined'
    ) {
      try {
        const file = new File([bytes as BlobPart], safeName, { type: 'application/pdf' });
        const canShareFile =
          typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });
        if (canShareFile) {
          await navigator.share({ title: safeName, files: [file] });
          return { ok: true, status: 'shared', message: `Shared ${safeName}` };
        }
      } catch (err) {
        if (isShareCanceledError(err)) {
          return { ok: false, status: 'canceled', message: 'Share cancelled' };
        }
        // Fall through to download fallback
      }
    }

    if (platform.saveFile) {
      const saved = await platform.saveFile(bytes, safeName, 'application/pdf');
      if (saved && typeof saved === 'object' && 'saved' in saved && !saved.saved) {
        return { ok: false, status: 'canceled', message: 'Save cancelled' };
      }
      return {
        ok: true,
        status: 'saved-fallback',
        message: `Direct sharing unsupported in this browser; downloaded ${safeName}`,
      };
    }
  }

  // 3. Electron desktop: try Web Share only if genuinely supported, never falsely claim success
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof File !== 'undefined'
  ) {
    try {
      const file = new File([bytes as BlobPart], safeName, { type: 'application/pdf' });
      if (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })) {
        await navigator.share({ title: safeName, files: [file] });
        return { ok: true, status: 'shared', message: `Shared ${safeName}` };
      }
    } catch (err) {
      if (isShareCanceledError(err)) {
        return { ok: false, status: 'canceled', message: 'Share cancelled' };
      }
    }
  }

  return {
    ok: false,
    status: 'unsupported',
    message: 'Direct OS sharing is unavailable on desktop. Use Save / Download instead.',
  };
}
