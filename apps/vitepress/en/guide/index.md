# Ecosystem

`marcus-monorepo` is a pnpm + Turborepo frontend monorepo providing shared capability packages for multiple admin applications. Every package is versioned and published independently via Changesets, wired together with `workspace:*` during development.

## Current packages

| Package                                                    | Status | Description                                                                                          |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| [`@marcusok/excel-exporter`](/en/packages/excel-exporter/) | stable | Excel export engine: WASM-driven, full styling, Worker threading, streaming writes, SheetJS fallback |

## Engineering conventions

- Package manager: pnpm workspace (`pnpm >= 9`)
- Build orchestration: Turborepo (`^build` resolves package order automatically)
- Package build: tsup (TS → ESM + DTS, ESM-only)
- Language: TypeScript 5.x (`moduleResolution: bundler`)
- Tests: Vitest; linting: ESLint 9 + Prettier
- Versioning/publishing: Changesets (independent versions, changelog, prerelease support)
- CI/CD: GitHub Actions (`ci.yml` checks, `release.yml` publishes to npm)

## Roadmap

The ecosystem grows on demand. Planned directions:

- PDF export
- File upload (chunking / progress)
- Virtual table rendering

When a new package ships, register it in `apps/vitepress/.vitepress/registry.ts` and add its docs; it automatically appears in the navigation, sidebar and home cards.
