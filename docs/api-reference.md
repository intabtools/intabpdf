# InTabPDF API & Type Reference

This document provides a comprehensive technical reference for the public interfaces, types, worker message protocols, and configuration schemas in InTabPDF.

---

## 1. Application Configuration (`src/config/screens.ts`)

Centralizes enabled screens, initial destinations per platform, and fallback resolution.

```typescript
export interface ScreenDestinationConfig {
  /** Map of enabled route paths to boolean flags */
  enabledScreens: Record<string, boolean>;
  /** Initial route destination path per platform type */
  initialDestinations: {
    web: string;
    electron: string;
    android: string;
  };
  /** Default visibility state of the application shell chrome */
  defaultShellVisibility: boolean;
}

export function resolveDestination(targetPath: string, platform: PlatformType): string;
```

### Destination Fallback Rules
- If `targetPath` matches an enabled screen (`'/'`, `'/viewer'`, `'/about'`, or `'/tool/:toolId'`), `resolveDestination` returns `targetPath`.
- If `targetPath` is disabled or unrecognized, `resolveDestination` falls back to `screenConfig.initialDestinations[platform]` (`'/'`).

---

## 2. Tool Registry (`src/tools/types.ts`, `src/tools/registry.ts`)

### `ToolAvailability`
```typescript
export type ToolAvailability = 'available' | 'coming-soon';
```

### `ToolDefinition`
```typescript
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string;
  fileType: 'pdf' | 'img' | 'txt';
  actionVerb: string;
  noun: string;
  outputName: string;
  multipleFiles: boolean;
  options: ToolOption[];
  availability: ToolAvailability;
  /** Lazy loader returning the tool module component */
  component?: () => Promise<{ default: ComponentType<ToolComponentProps> }>;
}
```

### `ToolComponentProps`
```typescript
export interface ToolComponentProps {
  tool: ToolDefinition;
  stagedFiles: StagedFile[];
  onFilesChange?: (files: StagedFile[]) => void;
  optionsState: Record<string, boolean>;
  onOptionsChange: (options: Record<string, boolean>) => void;
  /** Executes the async PDF runner via pdfProcessingService */
  onExecute: (runner: (signal: AbortSignal) => Promise<Uint8Array>) => Promise<void>;
  isProcessing: boolean;
  extraState?: Record<string, unknown>;
  onExtraStateChange?: (key: string, value: unknown) => void;
  outputBaseName?: string;
  onOutputBaseNameChange?: (name: string) => void;
  defaultBaseName?: string;
  outputExtension?: '.pdf' | '.zip' | string;
}
```

### Registry Utility Functions
- `getToolById(id: string): ToolDefinition | undefined`: Retrieves tool metadata by ID.
- `isToolImplemented(id: string): boolean`: Returns `true` if `availability === 'available'`.
- `getAvailableTools(): ToolDefinition[]`: Filters tools where `availability === 'available'`.
- `getComingSoonTools(): ToolDefinition[]`: Filters tools where `availability === 'coming-soon'`.
- `getToolComponent(tool: ToolDefinition): LazyExoticComponent<ComponentType<ToolComponentProps>> | null`: Resolves and caches the dynamic `React.lazy` component wrapper for an available tool.
- `validateRegistry(): { valid: boolean; errors: string[] }`: Asserts that all tool IDs are unique, validly categorized, and have non-empty metadata.

---

## 3. PDF Worker Processing Service (`src/core/worker/service.ts`)

Dispatches compute-intensive PDF operations to a dedicated Web Worker with zero-copy transferable buffers and automatic fallback.

> [!NOTE]
> The service defensively isolates buffers before assigning them to transferable lists. The caller's original `Uint8Array` is never neutered or detached, guaranteeing safe retry or fallback.

### Types & Payloads
```typescript
export type PdfOperation =
  | 'merge'
  | 'rotate'
  | 'remove-pages'
  | 'split'
  | 'images-to-pdf'
  | 'compress'
  | 'text-to-pdf'
  | 'reorder'
  | 'sign'
  | 'protect'
  | 'unlock';

export interface OperationPayloads {
  merge: { buffers: Uint8Array[]; options?: MergeOptions };
  rotate: { buffer: Uint8Array; options?: RotateOptions };
  'remove-pages': { buffer: Uint8Array; pageIndices: number[] };
  split: { buffer: Uint8Array; ranges: PageRange[]; splitOptions?: SplitOptions };
  'images-to-pdf': { images: InputImage[]; options?: ImagesToPdfOptions };
  compress: { buffer: Uint8Array; options?: CompressOptions };
  'text-to-pdf': { text: string; options?: TextToPdfOptions };
  reorder: { buffer: Uint8Array; pageOrder: number[]; options?: ReorderOptions };
  sign: { buffer: Uint8Array; signatureBytes: Uint8Array; options?: SignOptions };
  protect: { buffer: Uint8Array; options: ProtectPdfOptions };
  unlock: { buffer: Uint8Array; options: UnlockPdfOptions };
}

export interface ExecuteOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

### `pdfProcessingService` Singleton
```typescript
class PdfProcessingService {
  /** Returns default timeout (60s, 120s, or 180s depending on operation) */
  public getDefaultTimeout(op: PdfOperation): number;

  /**
   * Executes a PDF operation asynchronously.
   * Transfers ArrayBuffers for zero-copy memory dispatch.
   * Falls back to main-thread processing if Worker is unsupported or fails.
   * Rejects if aborted via signal or if operation exceeds timeoutMs.
   */
  public execute<T extends PdfOperation>(
    operation: T,
    payload: OperationPayloads[T],
    optionsOrTimeout?: ExecuteOptions | number
  ): Promise<Uint8Array>;

  /** Detaches and terminates the active dispatched worker thread without independently rejecting pending or queued requests */
  public terminateWorker(): void;
}

export const pdfProcessingService: PdfProcessingService;
```

> [!IMPORTANT]
> **Cancellation & Progress:** Passing `signal` in `ExecuteOptions` cancels queued requests, active Web Worker tasks (immediately terminating the dispatched worker and settling with `AbortError`), and cooperative main-thread fallbacks. Calling `terminateWorker()` directly only terminates the active dispatched worker thread. `pdfProcessingService` does not emit per-step progress percentages; `PdfToImagesTool` and multi-file batch operations (`executeBatchOperation`) report per-page and per-file progress via `ProcessingContext.updateMessage`.

---

## 4. Shell Context (`src/components/shellContextDef.ts`, `src/hooks/useShell.ts`)

Controls shell presentation mode and distraction-free layout visibility.

```typescript
export type ShellMode = 'web' | 'app';

export interface ShellContextType {
  shell: ShellMode;
  setShell: (mode: ShellMode) => void;
  showAppLayout: boolean;
  setShowAppLayout: (show: boolean | ((prev: boolean) => boolean)) => void;
}

export function useShell(): ShellContextType;
```

---

## 5. Platform Adapters (`src/platform/types.ts`, `src/platform/electron.ts`)

Standard interface across Web, Electron desktop, and Capacitor Android.

```typescript
export type SaveOutcomeStatus =
  | 'saved'
  | 'replaced'
  | 'cancelled'
  | 'failed_original_intact'
  | 'failed_recovery_available';

export interface SaveFileResult {
  saved: boolean;
  outcome?: SaveOutcomeStatus;
  fileName?: string;
  displayPath?: string;
  originalIntact?: boolean;
  message?: string;
  cleanupWarning?: SaveCleanupWarning;
  recovery?: RecoveryBackupSummary;
}

export interface PlatformAdapter {
  hasPendingFile?(): boolean;
  clearPendingFile?(): void;
  pickPdfFile(onStart?: (fileName: string) => void): Promise<OpenedFile | null>;
  onFileOpened(handler: (file: OpenedFile) => void): () => void;
  onFileOpenStart?(handler: (fileName: string) => void): () => void;
  onFileOpenError?(handler: (error: string) => void): () => void;
  saveFile?(bytes: Uint8Array, fileName: string, mimeType?: string): Promise<SaveFileResult | void>;
}
```

### Desktop & Mobile Bridge Extensions (`window.intab`, `window.NativeIntent`, Capacitor Plugins)

```typescript
declare global {
  interface Window {
    /** Electron preload IPC bridge */
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
    /** Android Capacitor native intent bridge */
    NativeIntent?: {
      hasPendingPdf?(): boolean;
      getPendingPdf?(): string;
      clearPendingPdf?(): void;
      resolveNativePdf?(uri: string): string;
    };
  }
}
```

Native Android Capacitor plugins registered in `MainActivity.java`:
- `DocumentSave` (`src/platform/androidSave.ts` ↔ `DocumentSavePlugin.kt`): `prepareSaveDestination`, `writeToDestination`, `listRecoveryBackups`, `exportRecoveryBackup`, `confirmDeleteRecoveryBackup`, `cleanupLeftoverSafFile`.
- `DocumentScanner` (`src/platform/scanner.ts` ↔ `DocumentScannerPlugin.kt`, Android-only): `isAvailable`, `startScan`, `cleanupOutput`.

---

## 6. Output Filename Utilities (`src/tools/filename.ts`)

Pure helper functions ensuring safe, consistent output file naming across platforms without requiring manual extension entry.

```typescript
export function getCleanBaseName(fileName: string): string;

export function getDefaultOutputBaseName(
  toolId: string,
  stagedFiles?: { name: string }[]
): string;

export function getOutputExtension(
  toolId: string,
  outputName?: string,
  stagedCount?: number
): '.pdf' | '.zip' | '.txt' | string;

export function sanitizeOutputFileName(
  input: string,
  fallbackBaseName: string,
  extension?: '.pdf' | '.zip' | '.txt' | string
): string;
```

### Sanitization & Safety Guarantees
- Automatically strips duplicate `.pdf`, `.zip`, or `.txt` extensions typed by users.
- Replaces filesystem-illegal characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, control chars) with `-`.
- Collapses consecutive dashes and removes leading/trailing dots or dashes.
- Appends `-file` to Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`).
- Locks output extension to the correct format (`.pdf`, `.zip`, `.txt`, or single-page image extension).
- Falls back safely to default operation base names if user input is empty or invalid.
