// Global type declaration for the Electron preload bridge and Android NativeIntent.
import type { OpenedFile } from './types';

declare global {
    interface Window {
        intab?: {
            hasPendingPdf?(): boolean;
            onOpenPdf(callback: (file: OpenedFile) => void): () => void;
            openExternalUrl?(url: string): void;
        };
        NativeIntent?: {
            hasPendingPdf?(): boolean;
            getPendingPdf?(): string;
            clearPendingPdf?(): void;
            resolveNativePdf?(uri: string): string;
        };
    }
}

export {};
