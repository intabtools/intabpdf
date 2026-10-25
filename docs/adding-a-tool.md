# Adding a New Tool to InTabPDF

InTabPDF uses a modular, plug-and-play architecture for all PDF tools. Adding a new tool requires no changes to the app router, navigation layout, or platform shells.

---

## 1. Overview of Steps

```mermaid
flowchart LR
    A["1. Core function in src/core/"] --> B["2. Unit test in src/core/"]
    B --> C["3. Worker dispatch in src/core/worker/"]
    C --> D["4. Tool UI Module in src/tools/modules/"]
    D --> E["5. Register in src/tools/registry.ts"]
    E --> F["6. Verify build & tests"]
```

---

## 2. Step-by-Step Implementation Guide

### Step 1: Implement the Pure PDF Operation in `src/core/`

Create or extend a function in `src/core/` (e.g., `src/core/compress.ts`). The function must be pure: accept byte buffers and options, and return a transformed `Uint8Array`.

```typescript
// src/core/compress.ts
import { PDFDocument } from 'pdf-lib';

export interface CompressOptions {
  shrinkImages?: boolean;
}

export async function compressPdf(
  buffer: Uint8Array,
  options?: CompressOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer);
  // Perform PDF compression or stripping operations
  return await doc.save({ useObjectStreams: true });
}
```

Export the function from [src/core/index.ts](file:///home/ayusman/Desktop/intabpdf/src/core/index.ts):
```typescript
export * from './compress';
```

### Step 2: Write Unit Tests

Add unit tests in [src/core/pdf.test.ts](file:///home/ayusman/Desktop/intabpdf/src/core/pdf.test.ts) using `vitest`:
```typescript
describe('compressPdf', () => {
  it('compresses a PDF document and produces valid output', async () => {
    const testPdf = await createTestPdf(3);
    const compressed = await compressPdf(testPdf);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.byteLength).toBeGreaterThan(0);
  });
});
```

### Step 3: Add to the Web Worker and Processing Service

Update [src/core/worker/service.ts](file:///home/ayusman/Desktop/intabpdf/src/core/worker/service.ts):
1. Add the operation key to `PdfOperation`:
   ```typescript
   export type PdfOperation = 'merge' | 'rotate' | 'remove-pages' | 'compress';
   ```
2. Define the payload structure in `OperationPayloads`:
   ```typescript
   export interface OperationPayloads {
     // ...
     compress: { buffer: Uint8Array; options?: CompressOptions };
   }
   ```
3. Add the operation to `executeOnMainThread()` in `service.ts`.
4. Update [src/core/worker/pdfWorker.ts](file:///home/ayusman/Desktop/intabpdf/src/core/worker/pdfWorker.ts) in the worker message handler switch block.

### Step 4: Create the Tool UI Module in `src/tools/modules/`

Create `src/tools/modules/CompressTool.tsx`. This module renders tool-specific options and executes the job via `pdfProcessingService`:

```tsx
import type { ReactNode } from 'react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import { pdfProcessingService } from '../../core/worker/service';

export default function CompressTool({
  tool,
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const handleRun = () => {
    onExecute(async () => {
      const buffer = stagedFiles[0].bytes;

      return await pdfProcessingService.execute('compress', {
        buffer,
        options: {
          shrinkImages: optionsState['shrink'],
        },
      });
    });
  };

  return (
    <div className="card opts">
      <b>{tool.name} options</b>
      {/* Tool options checkboxes or sliders */}

      <OutputFilenameInput
        value={outputBaseName ?? ''}
        onChange={onOutputBaseNameChange ?? (() => {})}
        placeholder={defaultBaseName ?? 'compressed-document'}
        extension={outputExtension ?? '.pdf'}
      />

      <button
        type="button"
        className="cta"
        onClick={handleRun}
        disabled={isProcessing || stagedFiles.length === 0}
      >
        Compress PDF
      </button>
    </div>
  );
}
```

### Step 5: Register the Tool in `src/tools/registry.ts`

Find or declare your tool definition in [src/tools/registry.ts](file:///home/ayusman/Desktop/intabpdf/src/tools/registry.ts):
```typescript
{
  id: 'compress',
  name: 'Compress',
  description: 'Shrink file size without losing quality',
  category: 'Shrink and secure',
  icon: 'file-down',
  fileType: 'pdf',
  actionVerb: 'Compress',
  noun: 'file',
  outputName: 'compressed.pdf',
  availability: 'available', // change from 'coming-soon' to 'available'
  component: () => import('./modules/CompressTool'),
  options: [
    { id: 'shrink', label: 'Compress images', description: 'Downsample large photos', defaultValue: true },
  ],
}
```

Once registered in [src/tools/registry.ts](file:///home/ayusman/Desktop/intabpdf/src/tools/registry.ts), the tool is immediately active. The application shell and [src/pages/ToolPage.tsx](file:///home/ayusman/Desktop/intabpdf/src/pages/ToolPage.tsx) resolve the lazy component wrapper automatically via [`getToolComponent(tool)`](file:///home/ayusman/Desktop/intabpdf/src/tools/registry.ts#L254-L265) without requiring edits to page files, navigation rails, or routing definitions.

---

## 3. Verification

Always run the verification suite to ensure zero regressions:

```bash
# 1. Type check and linting
npm run lint

# 2. Unit and worker tests
npx vitest run

# 3. Production Vite build (verifies dynamic chunk splitting)
npm run build

# 4. Electron desktop build
npm run build:desktop

# 5. Android native Java compile
cd android && ./gradlew compileDebugJavaWithJavac
```
