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
  options: ToolOptionDefinition[];
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
  onExecute: (runner: () => Promise<Uint8Array>) => Promise<void>;
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
export type PdfOperation = 'merge' | 'rotate' | 'remove-pages' | 'split' | 'images-to-pdf' | 'compress';

export interface OperationPayloads {
  merge: {
    buffers: Uint8Array[];
  };
  rotate: {
    buffer: Uint8Array;
    options?: {
      clockwise?: boolean;
      allPages?: boolean;
      pageIndices?: number[];
    };
  };
  'remove-pages': {
    buffer: Uint8Array;
    pageIndices: number[];
  };
  split: {
    buffer: Uint8Array;
    ranges: PageRange[];
    splitOptions?: SplitOptions;
  };
  'images-to-pdf': {
    images: InputImage[];
    options?: ImagesToPdfOptions;
  };
  compress: {
    buffer: Uint8Array;
    options?: CompressOptions;
  };
}
```

### `pdfProcessingService` Singleton
```typescript
class PdfProcessingService {
  /**
   * Executes a PDF operation asynchronously.
   * Transfers ArrayBuffers for zero-copy memory dispatch.
   * Falls back to main-thread processing if Worker is unsupported or fails.
   * Rejects if operation exceeds timeoutMs (default 60,000ms).
   */
  public execute<T extends PdfOperation>(
    operation: T,
    payload: OperationPayloads[T],
    timeoutMs?: number
  ): Promise<Uint8Array>;

  /** Terminates the active worker thread and rejects pending requests */
  public terminateWorker(): void;
}

export const pdfProcessingService: PdfProcessingService;
```

> [!IMPORTANT]
> **Worker Limitations:** Individual worker operations currently run atomically to completion without per-task progress percentages or mid-operation cooperative cancellation tokens. Cancellation is performed at the worker lifecycle level via `terminateWorker()`.

---

## 4. Shell Context (`src/components/shellContextDef.ts`, `src/hooks/useShell.ts`)

Controls application chrome layout, mobile drawer state, search command palette, and full-screen reading mode.

```typescript
export interface ShellContextValue {
  shell: 'web' | 'app';
  platform: 'web' | 'electron' | 'android';
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  drawerOpen: boolean;
  toggleDrawer: () => void;
  closeDrawer: () => void;
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  showAppLayout: boolean;
  setShowAppLayout: (show: boolean) => void;
}

export function useShell(): ShellContextValue;
```

---

## 5. Platform Adapters (`src/platform/types.ts`)

Standard interface across Web, Electron desktop, and Capacitor Android.

```typescript
export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

export interface PlatformAdapter {
  pickPdfFile(): Promise<OpenedFile | null>;
  onFileOpened(handler: (file: OpenedFile) => void): () => void;
  saveFile?(bytes: Uint8Array, fileName: string, mimeType?: string): Promise<void>;
}
```

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
  outputName?: string
): '.pdf' | '.zip';

export function sanitizeOutputFileName(
  input: string,
  fallbackBaseName: string,
  extension?: '.pdf' | '.zip'
): string;
```

### Sanitization & Safety Guarantees
- Automatically strips duplicate `.pdf` or `.zip` extensions typed by users.
- Replaces filesystem-illegal characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, control chars) with `-`.
- Collapses consecutive dashes and removes leading/trailing dots or dashes.
- Appends `-file` to Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`).
- Locks output extension to the correct format (`.pdf` or `.zip`).
- Falls back safely to default operation base names if user input is empty or invalid.
