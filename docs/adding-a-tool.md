# Adding a new tool

Each tool lives in its own folder. This way two people can build two different tools without touching the same files.

## The steps

```mermaid
flowchart LR
    A["1. Core function and test"] --> B["2. Worker"]
    B --> C["3. Page"]
    C --> D["4. Tool definition"]
    D --> E["5. Register"]
    E --> F["6. Check and open PR"]
```

We will use a tool called `rotate` as the example. Use the Merge tool as your reference when it is ready.

## Step 1: Write the logic in `core`

Create `src/core/rotate.ts`. It must be a pure function. Bytes in, bytes out.

```ts
// src/core/rotate.ts
import { PDFDocument, degrees } from "pdf-lib";

export async function rotatePages(
  input: Uint8Array,
  angle: 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input);
  doc.getPages().forEach((page) => {
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return doc.save();
}
```

Then write a test next to it:

```ts
// src/core/rotate.test.ts
import { describe, it, expect } from "vitest";
import { rotatePages } from "./rotate";

describe("rotatePages", () => {
  it("rotates every page", async () => { /* ... */ });
  it("throws a clear error for a corrupt file", async () => { /* ... */ });
});
```

Rules for this step:

- No React, no `window`, no `document`, no platform code.
- Do not change the input array. Return a new one.
- Throw an `Error` with a clear message that a normal user can understand.

## Step 2: Create the worker

Create `src/tools/rotate/rotate.worker.ts`. Keep it thin. It only receives, calls `core` and replies.

```ts
// src/tools/rotate/rotate.worker.ts
import { rotatePages } from "../../core/rotate";

self.onmessage = async (e: MessageEvent) => {
  const { id, payload } = e.data;
  try {
    const result = await rotatePages(payload.bytes, payload.angle);
    self.postMessage({ id, ok: true, result }, [result.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message });
  }
};
```

## Step 3: Create the page

Create `src/tools/rotate/RotatePage.tsx`. Use the shared `ToolLayout`, `DropZone` and hooks. The page handles only the screen: choosing files, showing progress, showing errors and a download button.

## Step 4: Create the tool definition

```ts
// src/tools/rotate/index.ts (proposed)
import { RotateCw } from "lucide-react";
import type { ToolDefinition } from "../types";

export const rotate: ToolDefinition = {
  id: "rotate",
  name: "Rotate pages",
  description: "Turn pages left or right.",
  icon: RotateCw,
  route: "/rotate",
  component: () => import("./RotatePage"), // loaded only when opened
};
```

## Step 5: Register the tool

Add one line to `src/tools/registry.ts`:

```ts
import { rotate } from "./rotate";

export const tools = [merge, split, rotate];
```

The home grid and the route are created automatically.

## Step 6: Check and open a pull request

Run these commands:

```bash
npm run lint
npm run build
npm test
```

Then go through the checklist below and open the PR.

## Final checklist

**Code**

- [ ] PDF logic is in `core/`, not in the component
- [ ] `core` function has tests: normal file, empty file, corrupt file, encrypted file
- [ ] Heavy work runs in a worker
- [ ] The tool does not import from another tool
- [ ] The tool is lazy loaded

**Privacy**

- [ ] No network calls, no analytics, no remote fonts or scripts
- [ ] No file data is saved anywhere after the user closes the tool

**User experience**

- [ ] Shows progress for slow jobs
- [ ] Shows a clear error message when something fails
- [ ] Works on a small mobile screen
- [ ] Works with keyboard only, and inputs and buttons have labels
- [ ] Tested with a large PDF (50 MB or more if you can)

**Project**

- [ ] New dependency (if any) passed the [dependency checklist](dependencies.md)
- [ ] Commit messages follow the [convention](commit-conventions.md)
- [ ] Tool is added to the roadmap or docs if needed

## Common mistakes

| Mistake | Fix |
|---|---|
| Calling `pdf-lib` directly inside the page | Move it to `core` and call it from the worker |
| Using `window` or `document` in `core` | Remove it. `core` must run in Node tests too |
| Copying code from another tool | Move the shared code to `core`, `components` or `hooks` |
| Forgetting to transfer the buffer | Pass `[result.buffer]` as the second argument to `postMessage` |
| Loading the full PDF library in the main bundle | Use dynamic `import()` for the page |
