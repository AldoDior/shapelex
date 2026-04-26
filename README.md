# ShapeLex

ShapeLex is an experimental MCP context compressor for reducing LLM read-token usage.

The MVP runs locally, keeps original text only in ephemeral memory, and gives agents compact `sx://` handles they can expand when exact wording matters.

## Run

```bash
npm start
```

For package-style usage after publishing:

```bash
npx shapelex-mcp
```

## MCP Tools

- `shapelex_compress_messages`: compress conversation history into expandable handles.
- `shapelex_compress_text`: compress pasted text, docs, or code-like snippets.
- `shapelex_expand`: expand one `sx://` handle back to exact original text.
- `shapelex_stats`: inspect active in-memory sessions.
- `shapelex_clear`: clear one session or all ephemeral memory.

## Design Constraints

- No database.
- No persistent memory.
- No external LLM or embedding API.
- Exact reconstruction works only while the MCP process is alive.

ShapeLex does not assume compressed word-shapes preserve perfect meaning. It preserves high-risk cues such as negation, numbers, dates, operators, and explicit instructions, and asks the agent to expand handles whenever exact text matters.
