# Commit conventions

Format: `area: short description`

- Use lowercase and imperative mood ("add", "fix", "update").
- No full stop at the end.
- Try to keep it under 70 characters.
- The **area** tells where the change is. The **description** tells what changed.

## Areas

| Area | Use it for |
|---|---|
| `core:` | PDF processing logic |
| `ui:` | Components, layout, styling, accessibility |
| `web:` | Browser app shell, routing, PWA, service worker |
| `desktop:` | Tauri side (Rust code, `tauri.conf`) |
| `android:` | Capacitor side (native config, plugins) |
| `build:` | Bundler, compiler config, scripts |
| `deps:` | Dependency updates |
| `ci:` | GitHub Actions and automation |
| `test:` | Tests |
| `docs:` | README, guides, privacy documentation |
| `logo:` | Logo, favicon and related image assets |
| `release:` | Version bumps and changelogs |

## Examples

```
core: add page rotation to merge
ui: fix drag-and-drop highlight in dark theme
desktop: bump tauri to latest
android: request storage permission on file pick
build: split pdf worker into separate chunk
deps: update pdf-lib
ci: run lint on pull requests
docs: explain offline guarantee
logo: update favicon
```

## Tips

- If a change touches many areas, use the main one, or leave the area out.
- For a breaking change, add `!` after the area: `core!: change export format`.
- Put the "fix" idea in the description, not in the tag: `core: fix crash on encrypted PDFs`.
- Link issues in the body: `Closes #12`.
- Do not invent new areas without discussion. If a new one is needed, add it to the table above in the same PR.

## Which area for a new tool?

| Part of the tool | Area |
|---|---|
| The PDF logic in `core/` | `core:` |
| Page, worker and other UI files | `ui:` |
| Tests | `test:` |

When one PR has all of these, use the main one (usually `core:`) and mention the tool name: `core: add rotate tool`.
