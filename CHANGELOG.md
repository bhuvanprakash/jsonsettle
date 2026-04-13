# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
