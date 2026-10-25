// Platform adapter for picking PDFs and listening for OS file-open events across Web, Electron, and Android.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import './electron';
import type { OpenedFile, PlatformAdapter, PlatformType } from './types';

function pickPdfFromInput(): Promise<OpenedFile | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf,.pdf';

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            const buffer = await file.arrayBuffer();
            resolve({ name: file.name, bytes: new Uint8Array(buffer) });
        };

        input.oncancel = () => resolve(null);
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
    } catch (err) {
        console.warn('Native Filesystem.readFile failed, trying fetch fallback:', err);
        try {
            const resp = await fetch(uri);
            const buf = await resp.arrayBuffer();
            return {
                name: extractFilename(uri),
                bytes: new Uint8Array(buf),
            };
        } catch (fetchErr) {
            console.error('Failed to read native PDF URI:', fetchErr);
            return null;
        }
    }
}

// Manage listeners across platforms (Electron and Capacitor)
const fileListeners = new Set<(file: OpenedFile) => void>();
const bufferedFiles: OpenedFile[] = [];

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

// Initialize native Capacitor handlers if on a native platform
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    // Warm start: intent arrives while app is already open/in background
    App.addListener('appUrlOpen', async (data) => {
        if (data.url && (data.url.toLowerCase().endsWith('.pdf') || data.url.startsWith('content://') || data.url.startsWith('file://'))) {
            const file = await readNativeUri(data.url);
            if (file) {
                dispatchFile(file);
            }
        }
    }).catch((err) => {
        console.warn('Failed to attach appUrlOpen listener:', err);
    });

    // Cold start: app opened directly via file intent
    App.getLaunchUrl().then(async (launchUrl) => {
        if (launchUrl?.url && (launchUrl.url.toLowerCase().endsWith('.pdf') || launchUrl.url.startsWith('content://') || launchUrl.url.startsWith('file://'))) {
            const file = await readNativeUri(launchUrl.url);
            if (file) {
                dispatchFile(file);
            }
        }
    }).catch((err) => {
        console.warn('Failed to retrieve cold-start launch URL:', err);
    });
}

export const platform: PlatformAdapter = {
    pickPdfFile: pickPdfFromInput,

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

    async saveFile(bytes: Uint8Array, fileName: string, mimeType?: string): Promise<void> {
        const isZip = fileName.toLowerCase().endsWith('.zip');
        const type = mimeType || (isZip ? 'application/zip' : 'application/pdf');

        // 1. Native Capacitor Android/iOS runtime
        if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
            try {
                const base64Data = uint8ArrayToBase64(bytes);

                // Attempt to write permanently to user Documents
                let documentsSaved = false;
                try {
                    await Filesystem.writeFile({
                        path: fileName,
                        data: base64Data,
                        directory: Directory.Documents,
                        recursive: true,
                    });
                    documentsSaved = true;
                } catch (docErr) {
                    console.warn('Could not write directly to Documents directory:', docErr);
                }

                // Also write to Cache so native share/view providers have immediate access
                const writeResult = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: Directory.Cache,
                    recursive: true,
                });

                // Present the native Android Share sheet
                const { Share } = await import('@capacitor/share');
                const canShare = await Share.canShare().then((r) => r.value).catch(() => false);
                if (canShare) {
                    await Share.share({
                        title: fileName,
                        url: writeResult.uri,
                        dialogTitle: `Save or Share ${fileName}`,
                    });
                    return;
                }

                if (documentsSaved) {
                    return;
                }
            } catch (nativeErr) {
                console.warn('Native Capacitor save/share failed, falling back to browser download:', nativeErr);
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
    },
};

export type { OpenedFile, PlatformType } from './types';
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
