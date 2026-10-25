// Global type declaration for the Electron preload bridge.
import type { OpenedFile } from './types';

declare global {
    interface Window {
        intab?: {
            onOpenPdf(callback: (file: OpenedFile) => void): () => void;
        };
    }
}

export {};
