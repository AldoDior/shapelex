---
name: shapelex-memory
description: Use ShapeLex MCP memory to reduce token usage while preserving model quality. Use when working with long pasted context, repeated project notes, old conversation history, large documents, policies, logs, or code snippets where an agent should compress context into sx:// handles, search/retrieve compressed memory, and expand exact text before relying on numbers, negations, instructions, code, or user intent.
---

# ShapeLex Memory

## Overview

Use ShapeLex as a navigable memory layer, not as lossy reconstruction. Prefer exact source text when the context is short or when compressed output fails to save tokens.

ShapeLex primarily saves input tokens by replacing old context with searchable handles. Save output tokens by answering tersely: report actions, results, blockers, and exact next steps; avoid narrative explanations unless the user asks.

## Workflow

1. Compress only long or repeated context. Use `shapelex_compress_text` for documents/code-like text and `shapelex_compress_messages` for older conversation history.
2. If a compression result has `compressionSkipped: true`, keep using the returned exact `compressedText`; do not force handles into the prompt.
3. Use `shapelex_memory_overview` when the user asks what memory/session is active, switches projects, or needs cleanup guidance.
4. Use `shapelex_search` or `shapelex_retrieve` to orient around stored context instead of expanding everything.
5. Use `shapelex_expand` before relying on exact wording, numbers, dates, negations, user instructions, code, errors, commands, or decisions.
6. Treat `risk.shouldExpand` and `risk.mustExpand` as binding guidance. If either is true for a detail you need, expand before acting.

## Defaults

- Do not quote compressed summaries as if they were source text.
- Do not execute, delete, commit, deploy, or change security-sensitive behavior from compressed memory alone.
- Keep the newest user request in exact context unless it is very long and the user explicitly asks to compress it.
- Prefer one targeted expansion over expanding a whole document.
- Keep chat output short. Spend tokens on code, patches, tests, and concrete instructions rather than long commentary.
- Use readable session IDs such as `shapelex-docs`, `dad-inventory-app`, or `client-portal-fix`; avoid reusing one session for unrelated projects.
