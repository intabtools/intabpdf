// Types for opening files across Web, Electron, and Android.

export type PlatformType = 'android' | 'electron' | 'web';

export interface OpenedFile {
    name: string;
    bytes: Uint8Array;
}

export interface PlatformAdapter {
    pickPdfFile(): Promise<OpenedFile | null>;
    onFileOpened(handler: (file: OpenedFile) => void): () => void;
    saveFile?(bytes: Uint8Array, fileName: string, mimeType?: string): Promise<void>;
}