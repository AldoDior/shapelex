# ShapeLex

ShapeLex is an experimental MCP navigable memory layer for reducing LLM read-token usage.

The MVP runs locally, keeps original text in a local ShapeLex store, and gives agents compact `sx://` handles they can expand when exact wording matters.

ShapeLex is implemented in TypeScript and compiles to `dist/` for runtime use.

ShapeLex is not designed to reconstruct full text from a lossy compressed prompt. It gives agents a hierarchy:

- Level 0: ultra summary.
- Level 1: semantic map.
- Level 2: anchors and fingerprints.
- Level 3: exact critical extracts.
- Level 4: exact expandable handles.

## Run

```bash
npm start
```

By default, the MCP server persists local memory in `.shapelex/`, which is ignored by git. Override the location with:

```bash
SHAPELEX_STORE_DIR=/path/to/store npm start
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

## MCP Tools

- `shapelex_compress`: compress text, code, or conversation into navigable memory.
- `shapelex_compress_messages`: compress conversation history into expandable handles and levels.
- `shapelex_compress_text`: compress pasted text, docs, or code-like snippets.
- `shapelex_expand`: expand one `sx://` handle back to exact original text.
- `shapelex_search`: search compressed memory without expanding full text.
- `shapelex_retrieve`: retrieve hierarchy levels for a ShapeLex document.
- `shapelex_explain`: explain how to use a ShapeLex URI.
- `shapelex_risk_assessment`: inspect semantic-loss and expansion risk.
- `shapelex_stats`: inspect active in-memory sessions.
- `shapelex_clear`: clear one session or all ephemeral memory.

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
- Local JSON persistence only; SQLite is a planned upgrade, not implemented yet.
- No external LLM or embedding API.
- Exact reconstruction works while the local ShapeLex store is available.

ShapeLex does not assume compressed word-shapes preserve perfect meaning. It preserves high-risk cues such as negation, numbers, dates, operators, code signals, decisions, and explicit instructions. Each document and span includes a risk assessment so the agent can decide when compressed context is enough and when exact expansion is required.
