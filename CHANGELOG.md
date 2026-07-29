# Changelog

## Unreleased

## 0.6.0 - 2026-07-28

- Added deterministic Unicode-aware lexical fingerprints, 64-bit rolling hashes, O(n) winnowing, offset voting, and English/Spanish critical-difference protection.
- Added a lazy, bounded, memory-only inverted index with explicit registration, stop-fingerprint suppression, LRU eviction, invalidation, and incomplete-search diagnostics.
- Made raw-byte equality plus full SHA-256 verification the only path to an `exact` match.
- Added exact source deduplication while preserving separate document and span `sx://` handles.
- Added transactional store format v2 with v1 migration, revisions, bounded locks, atomic fsync/rename writes, and content-addressed sources.
- Added compact match metadata to existing MCP results without adding another tool.
- Corrected MCP/package version parity, JSON-RPC error codes, and resource capability reporting.
- Raised the supported runtime to Node.js 22 or newer.
- Added property, acceptance, torture, performance, platform, coverage, mutation, packaging, and security verification.
- Added an offline protocol-token ledger and optional credentialed provider A/B evaluation.

## 0.5.0 - 2026-07-26

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
