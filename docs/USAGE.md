# ShapeLex Usage

ShapeLex is a local MCP server that stores exact source text in a private local JSON store and returns compact `sx://` handles. Agents should search or retrieve compressed levels first, then expand exact handles when details matter.

The local store is required because a handle is only a pointer. Without stored exact text, `shapelex_expand` could not recover the original words later.

## Install From Source

```powershell
npm install
npm run doctor
npm test
npm run build
```

Start the MCP server:

```powershell
npm start
```

`npm run doctor` checks Node.js version, compiled output, project MCP configs, private-store git ignores, and lean-mode tool exposure. Run it after cloning, after changing configs, or before helping another user set up ShapeLex.

For direct package usage after publishing:

```bash
npx -y shapelex-mcp --doctor
npx -y shapelex-mcp
```

Prefer `node ./bin/shapelex-mcp.js` or `npx -y shapelex-mcp` in MCP configs. That avoids shell-specific launchers and is smoother across Windows, macOS, and Linux. On Windows, it also avoids PowerShell execution-policy issues that can happen with `.ps1` command shims.

By default, local memory is stored in `.shapelex/`, which is ignored by git. To keep memory somewhere else:

```powershell
$env:SHAPELEX_STORE_DIR=".shapelex-private"
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

For Codex, Claude Code, and Cursor, use the lean MCP tool set to reduce tool-schema overhead:

```powershell
$env:SHAPELEX_TOOLSET="lean"
npm start
```

Lean mode exposes the normal low-overhead workflow: compress, get compact context, expand exact handles, inspect memory, and clean sessions. Use `SHAPELEX_TOOLSET="full"` when you want lower-level search, retrieve, risk, and debug tools.

The live Codex benchmark showed why this matters: exposing every MCP tool can cost more tokens than raw context. Lean mode fixed that by reducing the tool list loaded into the model.

## Claude Code

This repo includes a project-scoped Claude Code MCP config:

```text
.mcp.json
```

Claude Code may ask you to approve project MCP servers the first time it sees this file. That is expected.

For local source usage after `npm run build`:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- node ./bin/shapelex-mcp.js
```

For package usage after ShapeLex is published to npm:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp
```

On Windows, if Claude Code cannot launch `npx` directly, use this command form instead:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- cmd /c npx -y shapelex-mcp
```

Use `claude mcp list` and `/mcp` in Claude Code to verify that the server is connected. The `/mcp` panel shows the tool count, so it is a quick way to confirm ShapeLex is not exposing the full tool set by accident.

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

This repo includes a project-scoped Cursor MCP config:

```text
.cursor/mcp.json
```

Cursor supports MCP servers through `.cursor/mcp.json` for a project or `~/.cursor/mcp.json` globally. Cursor can also toggle MCP tools from chat; disabled tools are not loaded into context. ShapeLex uses lean mode by default so the useful tools stay available without loading the bigger debug surface.

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

If Cursor shows more ShapeLex tools than expected, disable the lower-level tools in Cursor or set `SHAPELEX_TOOLSET` back to `lean`.

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
npm run doctor
npm test
npm run benchmark
npm pack --dry-run --cache .\.npm-cache
```

The tarball should include `bin/`, `dist/`, `docs/`, `skills/`, `README.md`, `LICENSE`, `SECURITY.md`, and `package.json`. It should not include `.shapelex/`, `.npm-cache/`, `node_modules/`, private research notes, logs, or local config.

Publishing public npm packages is free. You need a free npm account. Unscoped packages such as `shapelex-mcp` are public by default; scoped packages such as `@yourname/shapelex-mcp` need `npm publish --access public` if you want them public.
