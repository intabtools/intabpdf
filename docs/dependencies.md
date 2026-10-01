# Dependencies

Fewer dependencies means a smaller app, fewer licence problems and less work later. Add a library only when it really saves effort.

```mermaid
flowchart TD
    A["Need a library?"] --> B{"Can we write it in about 20 lines?"}
    B -- Yes --> C["Write it ourselves"]
    B -- No --> D{"Licence compatible?"}
    D -- No --> E["Reject"]
    D -- Yes --> F{"No network or tracking code?"}
    F -- No --> E
    F -- Yes --> G{"Works in browser and Web Worker?"}
    G -- No --> E
    G -- Yes --> H{"Maintained and size OK?"}
    H -- No --> E
    H -- Yes --> I["Add it and explain in the PR"]
```

## Checklist before adding a package

- [ ] **Licence is compatible.** MIT, Apache-2.0, BSD and ISC are usually fine. **Be careful with GPL and AGPL.** AGPL can force the whole app to be open under AGPL terms, even when shared as a desktop or Android app.
- [ ] **No network or tracking code.** Look at the source and its own dependencies.
- [ ] **Works in the browser and in a Web Worker.** No Node-only APIs.
- [ ] **Actively maintained.** Recent releases and a healthy number of users.
- [ ] **Size is acceptable.** Check the build output. Lazy load big libraries inside the tool that needs them.
- [ ] **`package-lock.json` is committed.**

In the PR description, write the licence and why the package is needed.

## PDF libraries to evaluate

Please check the current licence yourself before you choose. Licences can change.

| Library | Typical use | Note |
|---|---|---|
| `pdf-lib` | Create, merge, split, edit pages | Pure JavaScript, popular for client-side work |
| `pdfjs-dist` | Draw pages on canvas, extract text | Mozilla PDF.js |
| MuPDF (WASM builds) | Fast rendering and compression | Has been AGPL in the past, so check carefully |

## Updating dependencies

- Use a `deps:` commit.
- Update one major dependency per PR.
- After updating a PDF library, run all tests and try every tool by hand.
- Run `npm audit` every month. See the [maintainer guide](maintainer-guide.md#monthly-health-check).
