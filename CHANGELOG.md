# Changelog

## Unreleased

- Added cumulative per-session compression telemetry with an explicit heuristic-estimator label.
- Removed opaque word-shape and fingerprint data from model-facing compression results while keeping the signals available internally.
- Added truncation and source-offset metadata so critical previews no longer imply exactness when shortened.
- Reduced duplicated MCP result text for compression, context, and expansion calls.
- Enforced the configured store-size limit before writes and cleaned failed temporary writes.
- Added workspace-bound file-backed compression through `shapelex_compress_text.sourcePath`, with checksum-verified expansion and no second full source copy in the ShapeLex store.
- Normalized and compacted persistent file-backed indexes instead of repeatedly serializing derived handle data.
- Made `SHAPELEX_PERSIST=0` a true memory-only mode that creates neither a store directory nor a gitignore entry.

## 0.4.0

- Added lean MCP toolset for Codex, Claude Code, and Cursor.
- Added `shapelex_context` for one-call compact task context.
- Added smoke and end-to-end workflow evaluations.
- Added agent adoption evaluation for agent-driven ShapeLex usage.
- Documented deterministic token-savings simulation results.
- Added cross-platform `shapelex-mcp --doctor`.
- Added project MCP configs for Codex, Claude Code, and Cursor.
- Added cleanup, store-size guard, and open-source safety documentation.
