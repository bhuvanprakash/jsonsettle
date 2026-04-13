# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.2] — 2026-04-13

### Changed
- **npm package name is now unscoped `jsonsettle`** — install with `npm install jsonsettle` and import from `jsonsettle`, `jsonsettle/react`, etc.
- Removed mistaken runtime dependency on the old scoped package name.

The previously published scoped package `@bhuvanprakash/jsonsettle` may remain on npm for older installs; prefer `jsonsettle` going forward.

## [0.1.1] — 2026-04-13

### Changed
- Version bump only: npm does not allow reusing a version number after it was ever published, even if the package was later unpublished. Publish as `0.1.1` instead.

## [0.1.0] — 2026-04-13

### Added
- Core streaming JSON state machine with `streaming` vs `certain` certainty per field
- Schema divergence early exit via `SchemaError`  
- Zod integration with nested path resolution and `createTypedParser`
- React hook `useStreamingJSON`
- Vue 3 composable `useStreamingJSON`
- Vanilla helpers: `fromReadableStream`, `fromAsyncIterable`, `fromFetchResponse`
- Python port with identical state machine, pydantic v2 extension, async helpers
- Interactive demo with three live scenarios
- GitHub Actions CI (Node 18/20/22), Pages deploy, npm + PyPI publish on tags
