## Development Setup

### TypeScript
npm install
npm run dev        # tsup in watch mode
npm test           # vitest
npm run typecheck  # tsc --noEmit

### Python
cd python
python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest

## Release Process

1. Update `version` in `package.json` and `python/pyproject.toml` to match
2. Update `CHANGELOG.md`
3. Commit: `git commit -m "release: v0.x.x"`
4. Tag:    `git tag v0.x.x`
5. Push:   `git push && git push --tags`
   → GitHub Actions publishes to npm and PyPI automatically

## Adding a New Adapter

1. Create `src/adapters/<framework>.ts`
2. Add `/// <reference types="<framework>" />` at top
3. Import only from `../core/parser.js` and `../core/types.js`
4. Add export entry in `package.json` exports map and `typesVersions`
5. Add entry to `tsup.config.ts`
6. Add tests in `tests/adapters.<framework>.test.ts`
