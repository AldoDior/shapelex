# Contributing

Thanks for helping improve ShapeLex.

ShapeLex is a local MCP memory layer. The main rule is simple: compressed memory must never pretend to be exact source text. Preserve exact expansion through `sx://` handles whenever wording, numbers, code, commands, negations, or user intent matter.

## Setup

```bash
npm install
npm run doctor
npm test
```

## Development

- Keep runtime dependencies at zero unless there is a strong reason.
- Keep local stores private. Do not commit `.shapelex*`, logs, caches, `dist/`, or `node_modules/`.
- Prefer `SHAPELEX_TOOLSET=lean` for Codex, Claude Code, and Cursor workflows.
- Add or update tests for behavior changes.
- Run `npm test`, `npm run smoke`, `npm run e2e`, and `npm pack --dry-run --cache ./.npm-cache` before release changes.

## Architecture Notes

- `src/shapelex.ts` contains the current engine and storage implementation.
- `src/mcp-server.ts` exposes the MCP JSON-RPC surface.
- `src/shapelex-doctor.ts` validates local setup and project MCP configs.
- `test/` uses Node's built-in test runner.

The current storage strategy is a single local JSON file. It is intentionally simple for personal use. Larger deployments should move toward one-file-per-document storage or SQLite before supporting very large memory stores.
