// Platform adapter for picking PDFs and listening for OS file-open events across Web, Electron, and Android.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem } from '@capacitor/filesystem';
import './electron';
import type { OpenedFile, PlatformAdapter, PlatformType, SaveFileResult } from './types';
import { saveFileAndroid } from './androidSave';

function pickPdfFromInput(onStart?: (fileName: string) => void): Promise<OpenedFile | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf,.pdf';
        input.style.display = 'none';
        if (typeof document !== 'undefined' && document.body) {
            document.body.appendChild(input);
        }

        let settled = false;
        const finish = (result: OpenedFile | null) => {
            if (settled) return;
            settled = true;
            if (input.parentNode) {
                input.parentNode.removeChild(input);
            }
            resolve(result);
        };

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                finish(null);
                return;
            }
            onStart?.(file.name);
            await new Promise((r) => setTimeout(r, 0));
            try {
                const buffer = await file.arrayBuffer();
                finish({ name: file.name, bytes: new Uint8Array(buffer) });
            } catch (err) {
                console.error('Failed to read file:', err);
                finish(null);
            }
        };

        input.oncancel = () => finish(null);
        input.click();
    });
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
    const CHUNK_SIZE = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        chunks.push(
            String.fromCharCode.apply(
                null,
                bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]
            )
        );
    }
    return btoa(chunks.join(''));
}

function base64ToUint8Array(base64: string): Uint8Array {
    const clean = base64.includes(',') ? base64.split(',')[1] : base64;
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function extractFilename(uri: string): string {
    try {
        const decoded = decodeURIComponent(uri);
        const segments = decoded.split(/[/\\]/);
        const last = segments[segments.length - 1];
        if (last && last.toLowerCase().endsWith('.pdf')) {
            return last;
        }
    } catch {
        // Fall through
    }
    return 'document.pdf';
}

async function readNativeUri(uri: string): Promise<OpenedFile | null> {
    // 1. Android NativeIntent bridge: fastest, direct streaming into internal cache, zero Base64
    if (typeof window !== 'undefined' && window.NativeIntent?.resolveNativePdf) {
        try {
            const raw = window.NativeIntent.resolveNativePdf(uri);
            if (raw) {
                const info = JSON.parse(raw);
                if (info.success && info.fileUrl) {
                    const converted = Capacitor.convertFileSrc(info.fileUrl);
                    const resp = await fetch(converted);
                    if (!resp.ok) {
                        throw new Error(`Failed to fetch cached PDF (HTTP ${resp.status})`);
                    }
                    const buf = await resp.arrayBuffer();
                    return {
                        name: info.name || extractFilename(uri),
                        bytes: new Uint8Array(buf),
                    };
                } else if (info.error) {
                    throw new Error(info.error);
                }
            }
        } catch (nativeErr: unknown) {
            console.error('NativeIntent.resolveNativePdf failed:', nativeErr);
            throw nativeErr;
        }
    }

    // 2. Direct fetch fallback via Capacitor convertFileSrc
    try {
        const converted = Capacitor.convertFileSrc(uri);
        const resp = await fetch(converted);
        if (resp.ok) {
            const buf = await resp.arrayBuffer();
            return {
                name: extractFilename(uri),
                bytes: new Uint8Array(buf),
            };
        }
    } catch (fetchErr) {
        console.warn('Direct fetch fallback failed:', fetchErr);
    }

    // 3. Fallback to Filesystem.readFile
    try {
        const result = await Filesystem.readFile({ path: uri });
        let bytes: Uint8Array;
        if (typeof result.data === 'string') {
            bytes = base64ToUint8Array(result.data);
        } else if (result.data instanceof Blob) {
            const buf = await result.data.arrayBuffer();
            bytes = new Uint8Array(buf);
        } else {
            return null;
        }
        return {
            name: extractFilename(uri),
            bytes,
        };
    } catch (fsErr) {
        console.error('Filesystem.readFile fallback failed:', fsErr);
    }

    return null;
}

// Manage listeners across platforms (Electron and Capacitor)
const fileListeners = new Set<(file: OpenedFile) => void>();
const fileStartListeners = new Set<(fileName: string) => void>();
const fileErrorListeners = new Set<(error: string) => void>();
const bufferedFiles: OpenedFile[] = [];

function dispatchFileStart(fileName: string) {
    for (const listener of fileStartListeners) {
        try {
            listener(fileName);
        } catch (err) {
            console.error('File start listener threw error:', err);
        }
    }
}

function dispatchFileError(error: string) {
    for (const listener of fileErrorListeners) {
        try {
            listener(error);
        } catch (err) {
            console.error('File error listener threw error:', err);
        }
    }
}

function dispatchFile(file: OpenedFile) {
    if (fileListeners.size === 0) {
        bufferedFiles.push(file);
        return;
    }
    for (const listener of fileListeners) {
        try {
            listener(file);
        } catch (err) {
            console.error('File listener threw error:', err);
        }
    }
}

let activeLaunchUri: string | null = null;
let lastConsumedUri: string | null = null;
let lastConsumedTime = 0;

export async function handleLaunchUri(uri: string): Promise<void> {
    if (!uri) return;

    const now = Date.now();
    // Prevent duplicate handling if already running or consumed within the last 3 seconds
    if (activeLaunchUri === uri || (lastConsumedUri === uri && (now - lastConsumedTime) < 3000)) {
        return;
    }

    activeLaunchUri = uri;
    dispatchFileStart(extractFilename(uri));

    try {
        const file = await readNativeUri(uri);
        if (file) {
            lastConsumedUri = uri;
            lastConsumedTime = Date.now();
            dispatchFile(file);
        } else {
            dispatchFileError('Could not open this PDF. Check whether the file is damaged, unsupported, or accessible.');
        }
    } catch (err: unknown) {
        console.error('Failed to read launch PDF:', err);
        const msg = err instanceof Error ? err.message : 'Could not open this PDF. Check whether the file is damaged, unsupported, or accessible.';
        dispatchFileError(msg);
    } finally {
        activeLaunchUri = null;
    }
}

// Initialize native Capacitor handlers if on a native platform
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    // Warm start: intent arrives while app is already open/in background (also handles retained cold-start event)
    App.addListener('appUrlOpen', async (data) => {
        if (data.url && (data.url.toLowerCase().endsWith('.pdf') || data.url.startsWith('content://') || data.url.startsWith('file://'))) {
            await handleLaunchUri(data.url);
        }
    }).catch((err) => {
        console.warn('Failed to attach appUrlOpen listener:', err);
    });

    // Cold start: check NativeIntent bridge first
    if (window.NativeIntent?.getPendingPdf) {
        const pending = window.NativeIntent.getPendingPdf();
        if (pending) {
            void handleLaunchUri(pending);
        }
    }

    // Cold start: App.getLaunchUrl fallback
    App.getLaunchUrl().then(async (launchUrl) => {
        if (launchUrl?.url && (launchUrl.url.toLowerCase().endsWith('.pdf') || launchUrl.url.startsWith('content://') || launchUrl.url.startsWith('file://'))) {
            await handleLaunchUri(launchUrl.url);
        }
    }).catch((err) => {
        console.warn('Failed to retrieve cold-start launch URL:', err);
    });
}

let pendingLaunchFileConsumed = false;

export const platform: PlatformAdapter = {
    hasPendingFile() {
        if (pendingLaunchFileConsumed) return false;
        if (typeof window !== 'undefined') {
            if (window.intab?.hasPendingPdf) {
                const has = Boolean(window.intab.hasPendingPdf());
                if (has) {
                    pendingLaunchFileConsumed = true;
                    return true;
                }
            }
            if (window.NativeIntent?.hasPendingPdf) {
                const has = Boolean(window.NativeIntent.hasPendingPdf());
                if (has) {
                    pendingLaunchFileConsumed = true;
                    return true;
                }
            }
        }
        return false;
    },

    clearPendingFile() {
        pendingLaunchFileConsumed = false;
        lastConsumedUri = null;
        lastConsumedTime = 0;
        if (typeof window !== 'undefined') {
            window.NativeIntent?.clearPendingPdf?.();
        }
    },

    pickPdfFile: pickPdfFromInput,

    onFileOpenStart(handler) {
        fileStartListeners.add(handler);
        return () => {
            fileStartListeners.delete(handler);
        };
    },

    onFileOpenError(handler) {
        fileErrorListeners.add(handler);
        return () => {
            fileErrorListeners.delete(handler);
        };
    },

    onFileOpened(handler) {
        // Register listener
        fileListeners.add(handler);

        // Deliver buffered files
        while (bufferedFiles.length > 0) {
            const next = bufferedFiles.shift()!;
            handler(next);
        }

        // Also connect Electron listener if present
        let electronUnsub: (() => void) | undefined;
        if (typeof window !== 'undefined' && window.intab?.onOpenPdf) {
            electronUnsub = window.intab.onOpenPdf((file) => {
                const bytes =
                    file.bytes instanceof Uint8Array
                        ? file.bytes
                        : new Uint8Array(file.bytes);
                dispatchFile({ name: file.name, bytes });
            });
        }

        return () => {
            fileListeners.delete(handler);
            if (electronUnsub) {
                electronUnsub();
            }
        };
    },

    async saveFile(bytes: Uint8Array, fileName: string, mimeType?: string): Promise<SaveFileResult | void> {
        const isZip = fileName.toLowerCase().endsWith('.zip');
        const type = mimeType || (isZip ? 'application/zip' : 'application/pdf');

        // 1. Native Capacitor Android runtime
        if (typeof window !== 'undefined' && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
            try {
                return await saveFileAndroid(bytes, fileName);
            } catch (nativeErr) {
                console.warn('Native Capacitor Android save failed:', nativeErr);
                throw nativeErr;
            }
        }

        // 2. Web and Electron fallback: HTML5 download anchor
        if (typeof document !== 'undefined') {
            const blob = new Blob([bytes as BlobPart], { type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return { saved: true, fileName };
    },
};

export type { OpenedFile, PlatformType, SaveFileResult } from './types';
export { openPdfInNewTab, revokeAllTrackedBlobUrls, getTrackedBlobUrlCount } from './webPdf';

export function openExternalUrl(url: string): void {
    if (typeof window !== 'undefined' && window.intab?.openExternalUrl) {
        window.intab.openExternalUrl(url);
        return;
    }
    if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

export function getPlatformType(): PlatformType {
    if (typeof window === 'undefined') return 'web';
    // 1. Allow URL query parameter override for automated platform testing (?platform=android|electron|web)
    try {
        const params = new URLSearchParams(window.location.search);
        const p = params.get('platform');
        if (p === 'android' || p === 'electron' || p === 'web') {
            return p;
        }
    } catch {
        // Ignore
    }
    // 2. Native Capacitor Android/iOS runtime
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        return 'android';
    }
    // 3. Electron desktop runtime
    if (
        window.intab !== undefined ||
        navigator.userAgent.includes('Electron') ||
        import.meta.env.MODE === 'desktop'
    ) {
        return 'electron';
    }
    // 4. Default web runtime
    return 'web';
}
