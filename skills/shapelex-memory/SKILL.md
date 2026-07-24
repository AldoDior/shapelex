---
name: shapelex-memory
description: Use ShapeLex MCP memory to reduce token usage while preserving model quality. Use when working with long pasted context, repeated project notes, old conversation history, large documents, policies, logs, or code snippets where an agent should compress context into sx:// handles, search/retrieve compressed memory, and expand exact text before relying on numbers, negations, instructions, code, or user intent.
---

# ShapeLex Memory

## Overview

Use ShapeLex proactively as a navigable memory layer, not as lossy reconstruction. ShapeLex is agent-driven by default: decide when it helps, and do not wait for the user to say "use ShapeLex" during long or repeated-context work. Prefer exact source text when the context is short or when compressed output fails to save tokens.

ShapeLex primarily saves input tokens by replacing old context with searchable handles. Save output tokens by answering tersely: report actions, results, blockers, and exact next steps; avoid narrative explanations unless the user asks.

## Workflow

1. Briefly tell the user the first time you use ShapeLex in a session, for example: "I am going to compress older context with ShapeLex to keep this session lighter." Do not repeat this for every tool call.
2. Compress only long or repeated context. Use `shapelex_compress_text` for documents/code-like text and `shapelex_compress_messages` for older conversation history.
3. If a compression result has `compressionSkipped: true`, keep using the returned exact `compressedText`; do not force handles into the prompt.
4. Use `shapelex_memory_overview` when starting work, when the user asks what memory/session is active, when switching projects, or when cleanup might be needed.
5. Use `shapelex_context` first. In full mode, use `shapelex_inspect` for deeper search or retrieve actions instead of expanding everything.
6. Use `shapelex_expand` before relying on exact wording, numbers, dates, negations, user instructions, code, errors, commands, or decisions.
7. Treat `risk.shouldExpand` and `risk.mustExpand` as binding guidance. If either is true for a detail you need, expand before acting.

## Defaults

- Agent-driven is the default. Manual user prompts like "use ShapeLex" are optional fallback commands, not the normal workflow.
- Do not use ShapeLex for tiny one-off tasks where the MCP call and handle text would cost more than the original context.
- Do not quote compressed summaries as if they were source text.
- Do not execute, delete, commit, deploy, or change security-sensitive behavior from compressed memory alone.
- Keep the newest user request in exact context unless it is very long and the user explicitly asks to compress it.
- Prefer one targeted expansion over expanding a whole document.
- Keep chat output short. Spend tokens on code, patches, tests, and concrete instructions rather than long commentary.
- Use readable session IDs such as `shapelex-docs`, `inventory-app`, or `client-portal`; avoid reusing one session for unrelated projects.
