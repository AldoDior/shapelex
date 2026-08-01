# ShapeLex Usage

ShapeLex is a local MCP server that stores exact source text in a private local JSON store and returns compact `sx://` handles. It should be agent-driven after setup: the agent decides when it helps, uses compact context first, and expands exact handles when details matter.

The local store is required because a handle is only a pointer. Without stored exact text, `shapelex_expand` could not recover the original words later.

ShapeLex v0.6 uses a lazy in-memory lexical fingerprint index to recognize registered text without scanning your workspace. A fingerprint proposes a candidate; only equal UTF-8 bytes plus full SHA-256 verification produce an exact match. Similar matches are advisory and should be expanded when precision matters.

## What You Need

You need:

1. Node.js installed on your computer.
2. An AI app that supports MCP, such as Codex, Claude Code, or Cursor.
3. The npm package `shapelex-mcp`.

You do not need an npm account to use ShapeLex. An npm account is only needed to publish packages.

## Step 1: Install Node.js

1. Go to [nodejs.org](https://nodejs.org/).
2. Download Node.js 22 LTS or newer.
3. Install it with the normal installer options.
4. Close and reopen your terminal.

Recommended terminal:

- Windows: PowerShell or Windows Terminal.
- macOS: Terminal.
- Linux: your normal terminal.

Check that Node and npm work:

```powershell
node --version
npm --version
```

If both commands print a version, you are ready for the next step.

## Step 2: Test ShapeLex

Run:

```powershell
npx -y shapelex-mcp --doctor
```

What this means:

- `npx` runs an npm package without installing it globally.
- `-y` accepts the package download prompt automatically.
- `shapelex-mcp` is the package name.
- `--doctor` checks whether your machine is ready.

If you see `Result: ready`, ShapeLex works.

## Ask An Agent To Help

If MCP setup feels confusing, copy the prompt in [docs/AGENT_SETUP_PROMPT.md](AGENT_SETUP_PROMPT.md) into Codex, Claude Code, or Cursor. It tells the agent to verify Node.js, configure ShapeLex safely, avoid committing `.shapelex*` memory folders, and test the setup.

After setup, add the persistent instruction in [docs/AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) if your AI app supports project instructions, rules, or memory. That tells the agent to use ShapeLex proactively, briefly notify you the first time it compresses context, and keep manual commands as a fallback.

## Install From Source

This is only needed if you want to develop ShapeLex itself.

```powershell
npm install
npm run doctor
npm test
npm run build
npm run typecheck:v06
npm run coverage:v06
```

Start the MCP server:

```powershell
npm start
```

`npm run doctor` checks Node.js version, compiled output, project MCP configs, private-store git ignores, and lean-mode tool exposure. Run it after cloning, after changing configs, or before helping another user set up ShapeLex.

For direct package usage from npm:

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

This mode creates no ShapeLex store directory or store file. Its handles are temporary and disappear when the MCP server stops.

The persistent v2 store keeps one exact content-addressed copy of duplicate pasted text. File-backed sources remain in the workspace and are not copied into the store. Fingerprint postings are never persisted.

To raise the store safety limit from the default 100 MiB:

```powershell
$env:SHAPELEX_MAX_STORE_MB="250"
npm start
```

ShapeLex uses the lean MCP toolset by default to reduce tool-schema overhead in Codex, Claude Code, and Cursor. You can still set it explicitly:

```powershell
$env:SHAPELEX_TOOLSET="lean"
npm start
```

Lean mode exposes the normal low-overhead workflow: compress, get compact context, expand exact handles, inspect memory, and clean sessions. Use `SHAPELEX_TOOLSET="full"` only when you want the compact `shapelex_inspect` tool for lower-level search, retrieve, explain, risk, and stats actions.

Token-sensitive AI clients can omit the optional structured copy of each tool result:

```powershell
$env:SHAPELEX_RESPONSE_MODE="content-only"
npm start
```

The default `compatible` mode retains `structuredContent` for programmatic integrations. `content-only` preserves the required MCP text content and is recommended when the client uses ShapeLex through the model rather than parsing structured results itself.

The live Codex benchmark showed why this matters: exposing too many MCP tools can cost more tokens than raw context. ShapeLex defaults to lean, and full mode keeps the extra surface consolidated into one compact inspect tool.

Agent behavior should be simple:

- Stay on lean for normal coding and long-session memory.
- Suggest full mode only when lean mode cannot answer a deeper search, retrieve, explain, risk, or stats question.
- Suggest a new session when the project, repo, client, feature, or task changes.
- Suggest cleanup when memory is old, noisy, unrelated, or confusing.
- Preview cleanup first; do not delete memory without confirmation.

## Claude Code

Use this section if you want ShapeLex in Claude Code.

This repo already includes a project-scoped Claude Code MCP config:

```text
.mcp.json
```

Claude Code may ask you to approve project MCP servers the first time it sees this file. That is expected.

Recommended npm setup:

1. Open a terminal in your project folder.
2. Run:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp
```

3. Verify:

```bash
claude mcp list
```

4. Open Claude Code and check:

```text
/mcp
```

On Windows, if Claude Code cannot launch `npx` directly, use this command instead:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- cmd /c npx -y shapelex-mcp
```

For local source usage after `npm run build`, use this instead of the npm command:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- node ./bin/shapelex-mcp.js
```

After setup, ask Claude Code once:

```text
Use ShapeLex memory overview. What memory session am I using?
```

## Codex

Use this section if you want ShapeLex in Codex.

ShapeLex is designed as a local stdio MCP server. This repo already includes a project-local Codex config:

```text
.codex/config.toml
```

If you are using this repository directly, build it first:

```powershell
npm install
npm run build
```

For npm usage in another project, configure Codex to start ShapeLex with this command:

```text
npx -y shapelex-mcp
```

Use this environment variable:

```text
SHAPELEX_STORE_DIR=.shapelex-codex
```

Example Codex MCP config:

```toml
[mcp_servers.shapelex]
command = "npx"
args = ["-y", "shapelex-mcp"]
startup_timeout_sec = 10
tool_timeout_sec = 60

[mcp_servers.shapelex.env]
SHAPELEX_STORE_DIR = ".shapelex-codex"
SHAPELEX_MAX_STORE_MB = "100"
SHAPELEX_TOOLSET = "lean"
```

Then open a new Codex task and ask once:

```text
Use ShapeLex memory overview. What memory session am I using?
```

For this source repo, the included config starts ShapeLex from:

```text
node ./bin/shapelex-mcp.js
```

Use the bundled `skills/shapelex-memory` skill instructions alongside the MCP server so the agent knows when to compress, search, retrieve, expand, and keep chat output terse. Those instructions make ShapeLex agent-driven by default.

## Cursor

Use this section if you want ShapeLex in Cursor.

This repo already includes a project-scoped Cursor MCP config:

```text
.cursor/mcp.json
```

Cursor supports MCP servers through `.cursor/mcp.json` for a project or `~/.cursor/mcp.json` globally. ShapeLex uses lean mode by default so the useful tools stay available without loading the bigger full-mode surface.

Recommended npm setup:

1. Create a `.cursor` folder in your project if it does not exist.
2. Create or edit `.cursor/mcp.json`.
3. Put this inside:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "npx",
      "args": ["-y", "shapelex-mcp"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex-cursor",
        "SHAPELEX_TOOLSET": "lean"
      }
    }
  }
}
```

4. Restart Cursor or reload the window.
5. In Cursor chat, ask once:

```text
Use ShapeLex memory overview. What memory session am I using?
```

For local source usage after `npm run build`, use this instead of the npm command:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "node",
      "args": ["C:\\path\\to\\ShapeLex\\bin\\shapelex-mcp.js"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex-cursor",
        "SHAPELEX_TOOLSET": "lean"
      }
    }
  }
}
```

If Cursor shows more ShapeLex tools than expected, set `SHAPELEX_TOOLSET` back to `lean` or disable unwanted tools in Cursor.

## Tool Workflow

This is the agent's default workflow. The user can still ask manually, but the agent should not depend on that.

1. Briefly tell the user the first time ShapeLex compresses context in a session.
2. Use `shapelex_compress_text` for long text, docs, logs, or code-like snippets. When the content already exists in the workspace, pass `sourcePath` instead of `text` so ShapeLex references the original file and validates its checksum without storing another full copy.
3. Use `shapelex_compress_messages` for older conversation history.
4. Use `shapelex_memory_overview` to see which session is active and whether cleanup is recommended.
5. Suggest a new `sessionId` when the project, repo, client, feature, or task changes.
6. Suggest cleanup when memory is old, noisy, unrelated, or confusing. Preview cleanup before deleting.
7. If the result has `compressionSkipped: true`, use the returned exact text. ShapeLex decided compression would not save enough tokens.
8. Use `shapelex_context` first to get compact task-ready context in one call.
9. In full mode, use `shapelex_inspect` only when you need deeper search, retrieve, explain, risk, or stats actions.
10. Use `shapelex_expand` before relying on exact wording, numbers, dates, code, commands, negations, or user intent.

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

Latest measured example:

- Raw prompt estimate: `2160` tokens.
- ShapeLex prompt estimate: `699` tokens.
- Approximate prompt-token reduction: `67.6%`.
- Result: same required facts and same coding decision.

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

Latest measured example:

- Three simulated coding scenarios.
- Raw prompt total: `6573` tokens.
- ShapeLex lean prompt total: `2148` tokens.
- Approximate lean prompt-token reduction: `67.3%`.
- Full-mode loaded total, including tool schema: `4800` tokens.
- Approximate full-mode loaded reduction versus raw: `26.7%`.
- Raw quality score: `1.0`.
- ShapeLex quality score: `1.0`.

These numbers are examples from the deterministic test suite, not a universal promise. Savings are usually better when old context is large and repeated. Savings can be small or zero for tiny tasks, exact code snippets, or cases where the agent needs to expand many handles.

## Agent Adoption Eval

Run the agent-driven usage simulation:

```powershell
npm run agent-eval
```

This checks whether a compliant agent would choose ShapeLex without the user manually saying "use ShapeLex". The latest run expected ShapeLex in `5` of `6` scenarios and selected it in all `5`. It also checked that the agent suggests lean mode, full mode, session switching, and cleanup preview in the expected cases.

## Sessions In Plain English

A session is just a memory box. Use one memory box per project or task.

Good session names:

```text
inventory-app
shapelex-docs
client-portal
```

Bad pattern:

```text
default
```

Using `default` forever mixes unrelated memory. It works, but cleanup and search become worse.

The agent should suggest changing sessions when it notices a project or task switch. A useful message is:

```text
This looks like a different project. I should use a new ShapeLex session so the memory does not mix.
```

To see current memory, ask the agent:

```text
Use ShapeLex memory overview. What memory session am I using, and should I clean anything?
```

The answer should say which session is active, how many documents/handles it has, and what cleanup command to preview.

## What It Saves

ShapeLex saves input tokens. It reduces the old context that an agent has to reread during long sessions. It does not directly compress the model's answer after the model writes it.

To save output tokens, use the bundled skill instruction: keep responses terse, report results and next steps, and spend tokens on code and tests instead of long explanation.

## Privacy

ShapeLex stores exact source text locally. This is not cloud storage and ShapeLex does not send it to an external service. When ShapeLex starts inside a git repo, it auto-adds `.shapelex*` local store folders to `.gitignore`. Do not publish or share `.shapelex/`. If you compressed private conversation history, source code, documents, logs, or credentials by mistake, delete the relevant session with `shapelex_clear` or remove the local store.

## Scaling Notes

Store v2 uses one private transactional JSON file with revisions, an exclusive lock, checksum validation, fsync, and atomic replacement. Exact text sources are deduplicated, while the fingerprint postings remain disposable and memory-only. This keeps the local format inspectable and avoids adding a database dependency.

Very large months-long stores still require measurement and may eventually need a pluggable storage backend. ShapeLex will not add SQLite or one-file-per-span persistence until reproducible workloads show that Store v2 is the limiting factor and a migration can preserve every existing `sx://` handle.

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

The agent should suggest cleanup, but it should preview first and ask before deleting. That keeps memory safe while still preventing old sessions from becoming noisy.

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
