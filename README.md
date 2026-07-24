# ShapeLex

ShapeLex is a local MCP navigable memory layer for reducing LLM read-token usage.

ShapeLex runs locally, keeps original text in a local ShapeLex store, and gives agents compact `sx://` handles they can expand when exact wording matters.

ShapeLex is implemented in TypeScript and compiles to `dist/` for runtime use.

ShapeLex optimizes for model quality before token savings. If a compressed wrapper would not save enough tokens, ShapeLex returns exact text and marks the result with `compressionSkipped: true`.

ShapeLex mainly saves input tokens: old context can become compact handles instead of being pasted back into every prompt. Output tokens are controlled by agent instructions, so the bundled skill tells agents to keep chat output terse and spend tokens on code, tests, and exact next steps.

For Codex, Claude Code, and Cursor, set `SHAPELEX_TOOLSET=lean` so the MCP server exposes only the small normal workflow and keeps tool-schema overhead lower.

ShapeLex is not designed to reconstruct full text from a lossy compressed prompt. It gives agents a hierarchy:

- Level 0: ultra summary.
- Level 1: semantic map.
- Level 2: anchors and fingerprints.
- Level 3: exact critical extracts.
- Level 4: exact expandable handles.

## Run

Install and verify:

```bash
npm install
npm run doctor
npm test
npm run smoke
npm run e2e
npm run benchmark
```

Start the local MCP server:

```bash
npm start
```

By default, the MCP server persists local memory in `.shapelex/`, which is ignored by git. Override the location with:

```bash
SHAPELEX_STORE_DIR=/path/to/store npm start
```

Disable disk persistence for one run:

```bash
SHAPELEX_PERSIST=0 npm start
```

Increase the local store safety limit, in MiB:

```bash
SHAPELEX_MAX_STORE_MB=250 npm start
```

Run tests and the reproducible benchmark:

```bash
npm run build
npm test
npm run benchmark
```

For package-style usage after publishing:

```bash
npx shapelex-mcp
```

Check a machine setup:

```bash
npx shapelex-mcp --doctor
```

See [docs/USAGE.md](docs/USAGE.md) for Codex, Claude Code, and Cursor setup examples.

## MCP Tools

- `shapelex_compress`: compress text, code, or conversation into navigable memory.
- `shapelex_compress_messages`: compress conversation history into expandable handles and levels.
- `shapelex_compress_text`: compress pasted text, docs, or code-like snippets.
- `shapelex_expand`: expand one `sx://` handle back to exact original text.
- `shapelex_search`: search compressed memory without expanding full text.
- `shapelex_context`: get compact task-ready memory in one call.
- `shapelex_retrieve`: retrieve hierarchy levels for a ShapeLex document.
- `shapelex_explain`: explain how to use a ShapeLex URI.
- `shapelex_risk_assessment`: inspect semantic-loss and expansion risk.
- `shapelex_stats`: inspect active in-memory sessions.
- `shapelex_memory_overview`: explain active sessions in plain language and suggest cleanup.
- `shapelex_clear`: clear one session or all ephemeral memory.
- `shapelex_prune`: preview or remove old sessions by age or maximum session count.

## MCP Resources

ShapeLex also exposes `sx://` documents and levels through MCP resources:

- `sx://{session}/doc/{docId}`
- `sx://{session}/doc/{docId}/level/0`
- `sx://{session}/doc/{docId}/level/1`
- `sx://{session}/doc/{docId}/level/2`
- `sx://{session}/doc/{docId}/level/3`
- `sx://{session}/doc/{docId}/level/4`

## Design Constraints

- No database.
- Local JSON persistence only; per-document files or SQLite are planned upgrades for very large long-session stores.
- No external LLM or embedding API.
- Exact reconstruction works while the local ShapeLex store is available.
- Runtime dependencies are intentionally zero.
- Local `.shapelex/` memory can contain exact private text and must not be committed or published.

ShapeLex does not assume compressed word-shapes preserve perfect meaning. It preserves high-risk cues such as negation, numbers, dates, operators, code signals, decisions, and explicit instructions. Each document and span includes a risk assessment so the agent can decide when compressed context is enough and when exact expansion is required.

## Agent Skill

The repo includes `skills/shapelex-memory`, a compact workflow skill that tells an agent when to compress, search, retrieve, and expand. Use it alongside the MCP server for best results.

## Security

See [SECURITY.md](SECURITY.md). ShapeLex is local-only by design, has no runtime npm dependencies, and uses a package `files` allowlist so npm publishing does not include local stores, caches, dependencies, or private research notes.
