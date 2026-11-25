// Global type declaration for the Electron preload bridge and Android NativeIntent.
import type { OpenedFile } from './types';

declare global {
    interface Window {
        intab?: {
            hasPendingPdf?(): boolean;
            clearPendingPdf?(): void;
            onOpenPdf(callback: (file: OpenedFile) => void): () => void;
            onOpenPdfError?(callback: (errorData: { name: string; error: string }) => void): () => void;
            onOpenPdfStart?(callback: (startData: { name: string }) => void): () => void;
            openExternalUrl?(url: string): void;
            copyText?(text: string): Promise<boolean>;
            setViewerCopyAllowed?(allowed: boolean): void;
            onContextSelectAll?(callback: () => void): () => void;
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
