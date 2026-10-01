# Decisions log

This page records why we made important choices. Add a new entry when you make a decision that someone may question later. Add new entries at the bottom. Do not rewrite old entries. If a decision changes, add a new entry that replaces the old one.

## Template

```
## NNN: Title
Status: accepted (or: replaced by NNN)
Context: what problem or choice we had
Decision: what we chose
Consequences: what becomes easier and what becomes harder
```

---

## 001: Fully client-side, no backend

Status: accepted

Context: Online PDF tools usually upload files to a server. This is a privacy risk and also costs money to run.

Decision: All processing happens on the user's device. No backend, no accounts, no file storage.

Consequences: Strong privacy and no server cost. Speed depends on the user's device, so heavy work goes in Web Workers.

## 002: One TypeScript implementation for all platforms

Status: accepted

Context: We plan a web app, a desktop app (Tauri) and an Android app (Capacitor).

Decision: Tauri and Capacitor load the same web build. No native PDF code in Rust or Kotlin.

Consequences: A feature reaches all platforms together and behaves the same. Native shells stay thin.

## 003: Modular tool folders with a registry

Status: accepted

Context: Many contributors and many tools can cause merge conflicts and messy code.

Decision: Each tool lives in `src/tools/<name>/` and is listed in `tools/registry.ts`. Shared PDF logic lives in `core/`.

Consequences: People can build tools in parallel. The home grid and routes are created from the registry.

## 004: HashRouter

Status: accepted

Context: Static hosting, Tauri and Capacitor have no server to rewrite URLs.

Decision: Use `HashRouter`.

Consequences: Works everywhere without extra setup. URLs contain a `#`.

## 005: Commit format `area: description`

Status: accepted

Context: We want a clear history without heavy tooling.

Decision: Use a lowercase area prefix from a fixed list. See [Commit conventions](commit-conventions.md).

Consequences: Easy to read and filter. It is not exactly Conventional Commits, so changelog tools need a small custom setup.

## 006: Enforce architecture with tools, not only with reviews

Status: accepted

Context: Reviewers can forget rules, and contributors are often new.

Decision: Use ESLint import restrictions and CI so boundary mistakes fail automatically. See [Code quality](code-quality.md#enforce-boundaries-with-eslint).

Consequences: Less review effort and fewer arguments. A little setup work at the start.
