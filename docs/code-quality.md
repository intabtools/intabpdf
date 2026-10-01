# Code quality

This page shares some simple habits to keep our code clean and easy to understand. These are friendly tips, not exam rules. Nobody will reject your PR only because a tip was missed. We will just help you in the review.

## Tools we use or plan to use

| Tool | What it helps with | Command | Status |
|---|---|---|---|
| TypeScript (strict) | Catches mistakes before running | `npm run build` | Use now |
| ESLint | Finds bad patterns | `npm run lint` | Use now |
| Prettier | Keeps formatting same for everyone | Format on save | Recommended, config to be added soon |
| Vitest | Tests for `core` | `npm test` | To be added with the first `core` function |
| GitHub Actions (CI) | Runs the checks on every PR | automatic | Planned for later |

Once CI is ready, we would like all checks to pass before a PR is merged. Until then, please just run the checks on your own computer.

## Keep it simple and easy to explain

This is a group project. Code that only one person understands is a problem for everyone. So we prefer plain code to clever code.

- Start each file in `core/` and each tool's `index.ts` with a short comment (one to three lines) saying what it does.
- If you cannot explain a function in one sentence, split it.
- A simple `for` loop that everyone understands is better than a clever one-liner.
- Do not add a new layer, class or helper "for later". Wait until two tools really need it.
- Name things by what they do: `rotatePages`, not `process`.
- In your PR description write three things: what you changed, why, and how to test it.
- If a teammate cannot follow your PR in a few minutes, that is a sign to simplify it or add a comment. It is not a problem with the teammate.

## Habits that help

### TypeScript

- Keep `strict` mode on.
- Try not to use `any`. If you really need it, use `unknown` and check the type, or leave a small comment about why.
- Give public functions clear input and output types.
- Plain objects and small types are usually simpler than big classes.

### Functions and files

- One function should do one job. If you need the word "and" to explain it, maybe split it.
- If a file becomes very long (more than 300 lines or so), think about splitting it.
- Use clear names. `mergePdfs` is better than `doStuff`.
- Please remove dead code and commented-out code. Git already keeps the history.
- Comments should explain **why**, not **what**. The code already shows what.

### The `core` folder

This folder needs a little extra care, because everything depends on it.

- Functions are pure: same input gives same output.
- Never change the input array. Return a new one.
- No `window`, `document`, `localStorage`, `fetch`, or imports from Tauri or Capacitor.
- Throw an `Error` with a message that a normal person can understand, like `"This PDF is password protected."`.

### Automatic boundary checks (later)

When the project grows, we can let ESLint check the folder rules for us, so nobody has to remember them. Here is an idea for `eslint.config.js`:

```js
{
  files: ["src/core/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        "react", "react-dom",
        "@tauri-apps/*", "@capacitor/*",
        "**/platform/*", "**/components/*", "**/tools/*", "**/hooks/*",
      ],
    }],
    "no-restricted-globals": ["error", "window", "document", "localStorage", "fetch"],
  },
},
```

The plugin `eslint-plugin-boundaries` can also stop one tool from importing another tool.

## Testing

All logic in `core` should have tests. Try the normal case and a few bad cases.

| Case | Why it matters |
|---|---|
| Normal PDF | The main use |
| One page and many pages | Different sizes |
| Empty or zero-byte file | People do select the wrong file sometimes |
| Corrupt file | Should show a clear message, not crash |
| Password protected PDF | Very common in real life |
| Large file | Checks speed and memory |

Some small tips:

- Keep tiny sample PDFs in `src/core/__fixtures__/`. A few KB each is enough.
- Please do not commit real personal documents. Make your own sample files.
- Tests should run without internet.
- For screens, test by hand for now: a normal file, a big file and a bad file. We can add automatic screen tests later.

## Error handling

- `core` throws clear errors.
- The worker catches them and sends `{ ok: false, error }`.
- The page shows the message in simple words and lets the user try again.
- Please never show a blank screen or a raw error trace to the user.
- Avoid empty `catch {}` blocks. If something fails, someone should know.

## Performance tips

| Tip | Reason |
|---|---|
| Put heavy work in a Web Worker | The screen stays responsive |
| Send buffers as transferable | No extra copy of big files |
| Lazy load each tool page | Faster first load |
| Lazy load big libraries inside the tool that needs them | Smaller main bundle |
| Release memory: revoke object URLs, drop references to big arrays | Prevents crashes on phones |
| Process page by page when possible | Uses less memory |

Have a look at the bundle size in the `npm run build` output. If it grows a lot in one PR, just ask why.

## Accessibility

We want everyone to be able to use InTab PDF.

- Every input and button has a label.
- The whole tool works with the keyboard only.
- Colours are readable in both light and dark theme.
- Do not use only colour to show errors or status.
- Respect `prefers-reduced-motion`.

## Privacy in code

See [Privacy rules](privacy.md). In short: no `fetch`, no analytics, no remote scripts, no storing of files.

## When is a task done?

Here is a simple way to check before you open a PR:

- [ ] It follows the [architecture rules](architecture.md#the-simple-rules)
- [ ] The available checks pass
- [ ] New `core` logic has tests
- [ ] You tried it on desktop and on a small mobile screen
- [ ] No privacy rule is broken
- [ ] Docs are updated if something changed
- [ ] The PR is small and has a clear description

## Things to avoid, if possible

- PDF logic inside a React component
- One tool importing another tool
- `if (isTauri)` or `if (isAndroid)` outside `platform/`
- Copy-pasted code between tools
- A new library with no reason
- Very big PRs that change many unrelated things
- Silent failures
