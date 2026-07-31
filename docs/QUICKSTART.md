# ShapeLex Quick Start

[Español](QUICKSTART.es.md)

This guide is for people who want to use ShapeLex with Codex, Cursor, or Claude Code without needing to understand MCP internals.

ShapeLex is a local memory layer for long AI sessions. It lets an agent retrieve compact context first and expand exact text only when details matter.

## What ShapeLex Does

- Keeps exact source text available through expandable `sx://` handles.
- Reduces repeated input context in long sessions.
- Recognizes exact, relocated, reordered, and closely related registered text.
- Verifies equal UTF-8 bytes and a full SHA-256 digest before declaring an exact match.
- Protects numbers, dates, negations, commands, operators, code, and explicit instructions.
- Builds its bounded fingerprint index lazily in memory instead of creating a fingerprint database.
- Skips compression when the compact representation would not save tokens.

ShapeLex does not replace exact source text. When wording, code, numbers, dates, or instructions matter, the agent should expand the relevant handle before acting.

## Requirements

You need:

1. Node.js 22 or newer.
2. Codex, Cursor, or Claude Code.
3. A project folder where you want ShapeLex memory to live.

Check Node.js:

```bash
node --version
npm --version
```

Check the latest published ShapeLex package:

```bash
npx -y shapelex-mcp@latest --doctor
```

The expected result includes:

```text
Result: ready
```

The reported version should match the current release published on npm.

If you run the doctor from inside the ShapeLex source repository itself, use `npm run doctor`. Run the `npx` command from the project where you intend to use ShapeLex.

## Fastest Setup: Ask Your Agent

Open the project in Codex, Cursor, or Claude Code and paste this prompt:

```text
Set up or update ShapeLex MCP in this project.

Assume I am not technical and perform the safe setup directly.

Requirements:
- Detect whether I am using Codex, Cursor, or Claude Code and use the correct configuration for that app.
- Verify Node.js 22 or newer.
- Verify the latest published package with:
  npx -y shapelex-mcp@latest --doctor
- Inspect any existing ShapeLex configuration before editing it.
- If SHAPELEX_STORE_DIR already exists, preserve its exact value so previous memory remains available.
- If this is a new setup, use:
  - .shapelex-codex for Codex
  - .shapelex-cursor for Cursor
  - .shapelex-claude for Claude Code
- Configure SHAPELEX_TOOLSET=lean and SHAPELEX_MAX_STORE_MB=100.
- Preserve every unrelated MCP server and setting.
- Preserve existing project instructions and append the ShapeLex workflow without overwriting unrelated guidance.
- Do not delete or manually edit ShapeLex memory files.
- Do not set SHAPELEX_PERSIST=0 because I want cross-session memory.
- Verify that .shapelex* is ignored by Git.
- Add the persistent ShapeLex workflow instructions to the correct file:
  - Codex: AGENTS.md
  - Cursor: .cursor/rules/shapelex.mdc
  - Claude Code: CLAUDE.md
- Do not run the ShapeLex test, mutation, torture, or benchmark suites.
- Tell me which files you changed and ask me to restart or reload the app.
- After restart, verify the MCP connection with shapelex_memory_overview.

Use the normal unpinned command in the final MCP configuration:
  npx -y shapelex-mcp

On native Windows, use cmd /c when the app cannot launch npx directly.
```

The agent should explain what it will edit, preserve existing memory, and avoid touching unrelated configuration.

## Manual Setup

Choose the app you use. You only need one of the following sections.

### Codex

Codex can store MCP configuration globally in `~/.codex/config.toml` or inside a trusted project in `.codex/config.toml`.

Add:

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

Native Windows fallback:

```toml
[mcp_servers.shapelex]
command = "cmd"
args = ["/c", "npx", "-y", "shapelex-mcp"]
startup_timeout_sec = 10
tool_timeout_sec = 60

[mcp_servers.shapelex.env]
SHAPELEX_STORE_DIR = ".shapelex-codex"
SHAPELEX_MAX_STORE_MB = "100"
SHAPELEX_TOOLSET = "lean"
```

Restart Codex. Use `/mcp` or `codex mcp list` to confirm that `shapelex` is connected.

For persistent agent behavior, add the instructions from [Make ShapeLex Automatic](#make-shapelex-automatic) to the project root `AGENTS.md`.

### Cursor

Create or edit `.cursor/mcp.json` inside the project:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "npx",
      "args": ["-y", "shapelex-mcp"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex-cursor",
        "SHAPELEX_MAX_STORE_MB": "100",
        "SHAPELEX_TOOLSET": "lean"
      }
    }
  }
}
```

Native Windows fallback:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "shapelex-mcp"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex-cursor",
        "SHAPELEX_MAX_STORE_MB": "100",
        "SHAPELEX_TOOLSET": "lean"
      }
    }
  }
}
```

Preserve other servers already present in `mcpServers`. Restart Cursor or reload the window after saving.

For persistent agent behavior, create `.cursor/rules/shapelex.mdc` and add the instructions from [Make ShapeLex Automatic](#make-shapelex-automatic). Start the file with:

```markdown
---
description: Use ShapeLex proactively for long-session memory.
globs:
alwaysApply: true
---
```

### Claude Code

Run this command inside the project:

```bash
claude mcp add --scope local \
  --env SHAPELEX_STORE_DIR=.shapelex-claude \
  --env SHAPELEX_MAX_STORE_MB=100 \
  --env SHAPELEX_TOOLSET=lean \
  --transport stdio shapelex -- npx -y shapelex-mcp
```

Native Windows:

```powershell
claude mcp add --scope local --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean --transport stdio shapelex -- cmd /c npx -y shapelex-mcp
```

Verify:

```bash
claude mcp list
```

You can also use `/mcp` inside Claude Code. If you choose project scope instead of local scope, Claude Code writes `.mcp.json` and asks you to approve the project server.

For persistent agent behavior, add the instructions from [Make ShapeLex Automatic](#make-shapelex-automatic) to the project root `CLAUDE.md`.

<a id="make-shapelex-automatic"></a>

## Make ShapeLex Automatic

Add this instruction to the persistent project-instruction file for your app:

```markdown
## ShapeLex memory

- Use ShapeLex proactively for long pasted context, repeated project notes, older conversation history, large documents, logs, and code snippets.
- Briefly notify me the first time you compress context in a session. Do not repeat the notice for every tool call.
- Use one readable `sessionId` per project or task.
- Start with `shapelex_memory_overview` when memory state matters.
- When relevant content already exists in a workspace file, prefer `shapelex_compress_text` with `sourcePath`.
- Use `shapelex_context` before reloading old memory into the prompt.
- Expand `sx://` handles before relying on exact wording, numbers, dates, negations, instructions, code, errors, commands, or decisions.
- If ShapeLex returns `compressionSkipped: true`, use the exact returned text instead of forcing compression.
- Keep `SHAPELEX_TOOLSET=lean` for normal work. Suggest full mode only for deeper inspection.
- Suggest a new session when the project or task changes.
- Preview cleanup and ask for permission before deleting memory.
```

App-specific locations:

| App | Persistent instructions |
| --- | --- |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/shapelex.mdc` |
| Claude Code | `CLAUDE.md` |

## Confirm It Works

After restarting or reloading your app, ask:

```text
Use ShapeLex memory overview. What memory session am I using?
```

For a new task:

```text
Use ShapeLex for this long-running task. Use the sessionId client-portal-authentication.
```

To recover earlier decisions:

```text
Use ShapeLex to retrieve the relevant context from our earlier authentication decisions.
```

Before acting on exact details:

```text
Expand any ShapeLex handles containing exact requirements, numbers, commands, errors, dates, or decisions before making changes.
```

## Updating From an Older Version

1. Do not delete the existing `.shapelex*` directory.
2. Preserve the current `SHAPELEX_STORE_DIR` value.
3. Run `npx -y shapelex-mcp@latest --doctor`.
4. Keep the normal MCP command as `npx -y shapelex-mcp`.
5. Restart or reload the AI app.
6. Ask for `shapelex_memory_overview`.

ShapeLex migrates supported older stores after the next successful memory write. Do not edit the store JSON manually.

## Privacy and Cleanup

ShapeLex stores exact text locally. That text may contain private code, instructions, logs, or pasted material.

Make sure Git ignores:

```gitignore
.shapelex*
```

Use `shapelex_memory_overview` to inspect memory. Preview cleanup before using `shapelex_clear` or `shapelex_prune`. Do not delete a store merely because an MCP connection fails; fix the configuration first.

## Troubleshooting

### The doctor command is not recognized

- Confirm `node --version` reports Node.js 22 or newer.
- Close and reopen the terminal after installing Node.js.
- On Windows, try `npx.cmd -y shapelex-mcp@latest --doctor`.
- If you are inside the ShapeLex source repository, use `npm run doctor`.

### The MCP server does not appear

- Restart Codex, reload Cursor, or restart Claude Code.
- Check the exact configuration file for the selected app.
- On native Windows, use the `cmd /c` fallback.
- Preserve `SHAPELEX_STORE_DIR` while troubleshooting.

### Old memory appears missing

Compare the previous and current `SHAPELEX_STORE_DIR` values. A different directory creates a separate memory store; it does not mean the old memory was deleted.

### A short task does not save tokens

That can be correct. ShapeLex is designed to skip compression when the compact representation would cost more than the original text.

## More Documentation

- [Full usage reference](USAGE.md)
- [Agent setup prompt](AGENT_SETUP_PROMPT.md)
- [Complete agent instructions](AGENT_INSTRUCTIONS.md)
- [Security policy](../SECURITY.md)

Official app references:

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Cursor MCP](https://docs.cursor.com/context/model-context-protocol)
- [Cursor rules](https://docs.cursor.com/context/rules)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code memory and CLAUDE.md](https://code.claude.com/docs/en/memory)
