# ShapeLex Usage

ShapeLex is a local MCP server that stores exact source text in a private local JSON store and returns compact `sx://` handles. Agents should search or retrieve compressed levels first, then expand exact handles when details matter.

The local store is required because a handle is only a pointer. Without stored exact text, `shapelex_expand` could not recover the original words later.

## Install From Source

```powershell
npm install
npm test
npm run build
```

Start the MCP server:

```powershell
npm start
```

By default, local memory is stored in `.shapelex/`, which is ignored by git. To keep memory somewhere else:

```powershell
$env:SHAPELEX_STORE_DIR="D:\path\to\private\shapelex-store"
npm start
```

To keep memory only while the MCP server process is running:

```powershell
$env:SHAPELEX_PERSIST="0"
npm start
```

To raise the store safety limit from the default 100 MiB:

```powershell
$env:SHAPELEX_MAX_STORE_MB="250"
npm start
```

For Codex, use the lean MCP tool set to reduce tool-schema overhead:

```powershell
$env:SHAPELEX_TOOLSET="lean"
npm start
```

Lean mode exposes the normal low-overhead workflow: compress, get compact context, expand exact handles, inspect memory, and clean sessions. Use `SHAPELEX_TOOLSET="full"` when you want lower-level search, retrieve, risk, and debug tools.

## Claude Code

For local source usage after `npm run build`:

```powershell
claude mcp add --transport stdio shapelex -- node C:\path\to\ShapeLex\bin\shapelex-mcp.js
```

For package usage after ShapeLex is published to npm:

```powershell
claude mcp add --transport stdio shapelex -- cmd /c npx -y shapelex-mcp
```

Use `claude mcp list` and `/mcp` in Claude Code to verify that the server is connected.

## Codex

ShapeLex is designed as a local stdio MCP server. This repo includes a project-local Codex config:

```text
.codex/config.toml
```

Before testing in Codex:

```powershell
npm install
npm run build
```

Then open a new Codex task in this trusted repo. Ask:

```text
Use ShapeLex memory overview. What memory session am I using?
```

The MCP server should start from:

```text
node ./bin/shapelex-mcp.js
```

with local memory stored in:

```text
.shapelex-codex/
```

Use the bundled `skills/shapelex-memory` skill instructions alongside the MCP server so the agent knows when to compress, search, retrieve, expand, and keep chat output terse.

## Cursor

Cursor supports MCP servers through `.cursor/mcp.json` for a project or `~/.cursor/mcp.json` globally.

After ShapeLex is published to npm, use:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "npx",
      "args": ["-y", "shapelex-mcp"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex",
        "SHAPELEX_TOOLSET": "lean"
      }
    }
  }
}
```

For local source usage after `npm run build`, use:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "node",
      "args": ["C:\\path\\to\\ShapeLex\\bin\\shapelex-mcp.js"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex",
        "SHAPELEX_TOOLSET": "lean"
      }
    }
  }
}
```

In Cursor chat, ask: "Use ShapeLex memory overview. What memory session am I using?" The agent should call `shapelex_memory_overview`.

## Tool Workflow

1. Use `shapelex_compress_text` for long text, docs, logs, or code-like snippets.
2. Use `shapelex_compress_messages` for older conversation history.
3. Use `shapelex_memory_overview` to see which session is active and whether cleanup is recommended.
4. If the result has `compressionSkipped: true`, use the returned exact text. ShapeLex decided compression would not save enough tokens.
5. Use `shapelex_context` first to get compact task-ready context in one call.
6. Use `shapelex_search` and `shapelex_retrieve` only when you need deeper navigation.
7. Use `shapelex_expand` before relying on exact wording, numbers, dates, code, commands, negations, or user intent.

## Smoke Test

Run the raw-context versus ShapeLex-context smoke test:

```powershell
npm run smoke
```

The report compares:

- raw prompt token estimate
- ShapeLex prompt token estimate
- covered coding facts
- deterministic coding decision
- whether the ShapeLex version preserved the same result with fewer prompt tokens

This is not a full AI quality benchmark. It is a repeatable mechanical check that the MCP workflow can reduce input context while keeping the facts needed for a coding task.

## End-To-End Eval

Run the simulated end-to-end coding workflow eval:

```powershell
npm run e2e
```

The eval runs multiple coding scenarios twice:

- raw context, as if no ShapeLex tool existed
- ShapeLex context, as if the agent compressed old context, retrieved critical extracts, then generated code

It compares:

- total raw prompt tokens
- total ShapeLex prompt tokens
- generated-code quality checks
- fact retention
- per-scenario token savings

This does not call a live AI model. It is a deterministic workflow simulation, useful for regression testing ShapeLex behavior. A true live-model benchmark should run real Codex/Cursor/Claude tasks twice and compare final diffs, tests, and transcript token usage.

## Sessions In Plain English

A session is just a memory box. Use one memory box per project or task.

Good session names:

```text
dad-inventory-app
shapelex-docs
client-portal-fix
```

Bad pattern:

```text
default
```

Using `default` forever mixes unrelated memory. It works, but cleanup and search become worse.

To see current memory, ask the agent:

```text
Use ShapeLex memory overview. What memory session am I using, and should I clean anything?
```

The answer should say which session is active, how many documents/handles it has, and what cleanup command to preview.

## What It Saves

ShapeLex saves input tokens. It reduces the old context that an agent has to reread during long sessions. It does not directly compress the model's answer after the model writes it.

To save output tokens, use the bundled skill instruction: keep responses terse, report results and next steps, and spend tokens on code and tests instead of long explanation.

## Privacy

ShapeLex stores exact source text locally. This is not cloud storage and ShapeLex does not send it to an external service. Do not publish or share `.shapelex/`. If you compressed private conversation history, source code, documents, logs, or credentials by mistake, delete the relevant session with `shapelex_clear` or remove the local store.

## Scaling Notes

The current storage strategy is a single JSON file. It is simple, portable, and good enough for personal use and ordinary long sessions. It is not the final storage architecture for very large months-long memory.

For heavier use, the next storage upgrade should be one file per document/span or SQLite. That would avoid rewriting the entire store on every compression and scale better for many projects.

## Cleanup

Use one ShapeLex `sessionId` per project, task, or long-running workstream. Reusing one session for unrelated work makes search noisier and makes cleanup harder.

Inspect current memory:

```text
shapelex_memory_overview
```

Preview cleanup without deleting:

```json
{
  "olderThanDays": 14,
  "dryRun": true
}
```

Remove sessions not accessed in the last 14 days:

```json
{
  "olderThanDays": 14
}
```

Keep only the 10 most recently accessed sessions:

```json
{
  "maxSessions": 10
}
```

Clear one known session:

```json
{
  "sessionId": "my-old-project"
}
```

ShapeLex does not silently delete old memory. Silent cleanup can break `sx://` handles that an agent still expects to expand.

## Publishing Checklist

Before publishing to npm:

```powershell
npm test
npm run benchmark
npm pack --dry-run --cache .\.npm-cache
```

The tarball should include `bin/`, `dist/`, `docs/`, `skills/`, `README.md`, `LICENSE`, `SECURITY.md`, and `package.json`. It should not include `.shapelex/`, `.npm-cache/`, `node_modules/`, private research notes, logs, or local config.
