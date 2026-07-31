<p align="center">
  <img src="https://raw.githubusercontent.com/AldoDior/shapelex/main/.github/assets/shapelex-banner.png" alt="ShapeLex — Compact context. Exact on demand." width="100%">
</p>

# ShapeLex

<p align="center">
  Local-first MCP memory for lower-token AI coding sessions, with exact source expansion on demand.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/shapelex-mcp"><img src="https://img.shields.io/npm/v/shapelex-mcp?color=4F46E5&label=npm" alt="npm version"></a>
  <a href="https://github.com/AldoDior/shapelex/actions/workflows/ci.yml"><img src="https://github.com/AldoDior/shapelex/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/AldoDior/shapelex/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-111827" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-43853D" alt="Node.js 22 or newer">
</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#español">Español</a> ·
  <a href="https://www.npmjs.com/package/shapelex-mcp">npm</a> ·
  <a href="https://github.com/AldoDior/shapelex/releases">Releases</a> ·
  <a href="https://www.linkedin.com/in/aldo-diaz-ortega/">LinkedIn</a>
</p>

> **New to ShapeLex?** Start with the [English quick start](docs/QUICKSTART.md) for Codex, Cursor, and Claude Code.
>
> **¿Primera vez con ShapeLex?** Empieza con la [guía rápida en español](docs/QUICKSTART.es.md) para Codex, Cursor y Claude Code.

## English

ShapeLex is a local MCP memory server for AI coding tools. It helps long AI sessions use fewer input tokens by saving older context locally and giving the AI compact `sx://` handles it can expand when exact text matters.

Use ShapeLex with tools that support MCP, such as Codex, Claude Code, and Cursor.

ShapeLex is local-only by design:

- It stores exact memory on your computer.
- It does not call an external LLM.
- It does not use embedding APIs.
- It has zero runtime npm dependencies.
- It should not be used as a replacement for exact source text when details matter.

ShapeLex mainly saves input tokens. It reduces old context that the model has to reread. It does not automatically shorten the model's final answer; for output tokens, tell the agent to answer briefly and spend tokens on code, tests, and exact next steps.

ShapeLex v0.6 also recognizes text it has already seen. Deterministic lexical fingerprints locate exact, relocated, reordered, and closely related passages. Fingerprints only find candidates: ShapeLex reports `exact` only after the original UTF-8 bytes and full SHA-256 digest both match. Similar text is always advisory.

ShapeLex should be agent-driven after setup. You should not need to say "use ShapeLex" every time. Add the persistent instruction from [docs/AGENT_INSTRUCTIONS.md](docs/AGENT_INSTRUCTIONS.md) to your AI app or project rules when possible; then the agent should decide when ShapeLex helps, briefly tell you the first time it compresses context, and keep manual commands as a fallback.

The agent should also guide memory hygiene. It should recommend lean mode for normal work, suggest full mode only for deeper inspection, suggest a new session when the project or task changes, and suggest cleanup when memory becomes old, noisy, unrelated, or confusing. Cleanup should be previewed first and confirmed before deleting memory.

## Install

You need Node.js first. Node includes `npm` and `npx`, which are the commands used to run ShapeLex.

1. Install Node.js from [nodejs.org](https://nodejs.org/).
2. Choose Node.js 22 LTS or newer.
3. Open a terminal.
   - Windows: PowerShell or Windows Terminal.
   - macOS: Terminal.
   - Linux: your normal terminal.
4. Check that Node and npm work:

```bash
node --version
npm --version
```

5. Check that ShapeLex can run:

```bash
npx -y shapelex-mcp --doctor
```

If the doctor says `Result: ready`, ShapeLex is ready to use.

You usually do not need to install ShapeLex globally. `npx -y shapelex-mcp` downloads and runs the published npm package when your AI tool starts the MCP server.

## Quick Start

Manual test:

```bash
npx -y shapelex-mcp --doctor
```

Start the MCP server manually:

```bash
npx -y shapelex-mcp
```

Most users do not need to start it manually. Codex, Claude Code, or Cursor starts it from MCP configuration.

## AI App Setup

ShapeLex works as an MCP server. Each AI app needs to know what command starts ShapeLex.

Recommended command:

```bash
npx -y shapelex-mcp
```

ShapeLex defaults to the lean toolset because that is the normal token-saving mode. Use `SHAPELEX_TOOLSET=full` only when you want the compact `shapelex_inspect` tool for lower-level search, retrieve, explain, risk, and stats actions.

In normal use, let the agent recommend the mode. It should keep you on lean unless full mode would help inspect memory more deeply.

### Codex

In a Codex project, configure an MCP server named `shapelex` that runs:

```bash
npx -y shapelex-mcp
```

Recommended environment:

```text
SHAPELEX_STORE_DIR=.shapelex-codex
```

Then open a new Codex task and ask:

```text
Use ShapeLex memory overview. What memory session am I using?
```

### Claude Code

Run this command in your project folder:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 shapelex -- npx -y shapelex-mcp
```

On Windows, if Claude Code cannot launch `npx` directly, use:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 shapelex -- cmd /c npx -y shapelex-mcp
```

Verify:

```bash
claude mcp list
```

### Cursor

Create or edit `.cursor/mcp.json` inside your project:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "npx",
      "args": ["-y", "shapelex-mcp"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex-cursor"
      }
    }
  }
}
```

Restart Cursor or reload the window. In Cursor chat, ask:

```text
Use ShapeLex memory overview. What memory session am I using?
```

For detailed setup instructions, see:

- English: [docs/USAGE.md](docs/USAGE.md)
- Spanish: [docs/USAGE.es.md](docs/USAGE.es.md)

If setup feels confusing, copy the helper prompt from [docs/AGENT_SETUP_PROMPT.md](docs/AGENT_SETUP_PROMPT.md) into Codex, Claude Code, or Cursor and ask the agent to guide you.

For best results, also add the agent rule from [docs/AGENT_INSTRUCTIONS.md](docs/AGENT_INSTRUCTIONS.md). That rule tells the AI to use ShapeLex proactively for long sessions instead of waiting for you to remember it.

## How It Works

ShapeLex stores exact source text in a private local store and gives the agent compact handles.

Example handle:

```text
sx://default/span/span_1
```

That handle is a pointer. It is not the full text. If exact wording, numbers, code, commands, negations, or user instructions matter, the agent should expand the handle before relying on it.

ShapeLex gives agents a hierarchy:

- Level 0: short summary.
- Level 1: semantic map.
- Level 2: model-readable anchors and protected terms. Internal fingerprints are not sent to the model.
- Level 3: critical previews with explicit `exact`, `truncated`, and source-offset metadata.
- Level 4: exact expandable handles.

### Fingerprint retrieval

The `lexical-v1` profile combines strict Unicode-aware token fingerprints with a recall-only character channel. Its inverted index is built lazily in memory only for text and files explicitly registered with ShapeLex. It never crawls the workspace and never persists fingerprint postings.

Repeated or low-entropy hashes are suppressed, and query, candidate, verification, and memory work are bounded. When a limit may reduce recall, results report `searchComplete: false`.

Match kinds are `exact`, `normalized_equal`, `strong_related`, `related_reordered`, `related`, `keyword`, and `unrelated`. Only `exact` content may be automatically deduplicated. Changed negations, numbers, dates, operators, booleans, destructive verbs, and English or Spanish instructions prevent unsafe strong matching.

## Token Accounting

ShapeLex records cumulative compression telemetry per memory session: estimated raw tokens, estimated compressed tokens, skipped operations, and estimated savings. The current built-in counter is identified as `shapelex-heuristic-v1` and is explicitly marked `exact: false`.

These estimates are useful for deterministic local comparisons, but they are not provider billing data. A professional cost evaluation must also include model-specific token counts, tool schemas, tool arguments and results, expansions, cache reads and writes, native compaction, output tokens, and host-managed hidden context.

`shapelex_memory_overview` and full-mode stats expose the current telemetry without adding another MCP tool schema.

## File-Backed Memory

When the source already exists in the workspace, pass `sourcePath` instead of copying the file into `text`:

```json
{
  "sessionId": "my-project",
  "sourcePath": "src/checkout.ts"
}
```

ShapeLex analyzes the file and creates the same navigable memory, but stores file references and checksums instead of another full source copy. Expansion rereads the existing file and succeeds only while its checksum still matches. If the file changes, the old handle fails explicitly instead of returning stale content.

Paths are resolved against `SHAPELEX_WORKSPACE_ROOT` or the MCP server working directory. Path traversal and symbolic links cannot escape that workspace boundary.

Use `text` for transient pasted material and `sourcePath` for files already present in the project. Provide one, not both.

### Storage choices

Persistent memory remains the default so `sx://` handles survive MCP server restarts. Store format v2 uses revisions, a bounded process lock, atomic replacement, full SHA-256 records, and automatic migration from v1. Duplicate pasted text is kept once as an immutable content-addressed source while retaining separate public handles. With `sourcePath`, the store contains checksums, byte ranges, navigation data, and risk metadata—not a second full copy of the workspace file.

For work that must leave no ShapeLex store on disk, run the MCP server with:

```text
SHAPELEX_PERSIST=0
```

Memory-only mode creates no store directory or store file. Its tradeoff is deliberate: all handles disappear when the MCP server process stops, so files must be registered again after a restart.

## Privacy

Local ShapeLex memory may contain exact private text. ShapeLex auto-adds `.shapelex*` local store folders to `.gitignore` when it starts inside a git repo. Keep this warning anyway: do not commit or publish these folders.

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

This repo ignores those folders with `.gitignore`, and ShapeLex adds matching local store folders automatically for new projects.

## For Developers

If you want to work on ShapeLex itself:

```bash
git clone https://github.com/AldoDior/shapelex.git
cd shapelex
npm install
npm run check
```

Useful commands:

```bash
npm run doctor
npm test
npm run typecheck:v06
npm run coverage:v06
npm run smoke
npm run e2e
npm run agent-eval
npm run benchmark
```

Scheduled verification additionally runs 10,000-case properties, low-entropy torture, multi-process persistence stress, platform checks, and targeted mutation testing.

Optional live provider measurement is separate from CI:

```bash
SHAPELEX_PROVIDER_ENDPOINT=https://your-private-evaluator.example/run \
SHAPELEX_PROVIDER_API_KEY=... \
npm run eval:provider -- cases.json .shapelex-evals/provider-report.json
```

Credentials are read only from environment variables. Request and input-token caps default to 30 requests and 100,000 input tokens per request.

## Simulation Results

Before publishing, the repo was tested with deterministic raw-context versus ShapeLex-context simulations. These tests do not call a live AI model; they compare prompt size, retained facts, and generated-code checks in repeatable scenarios.

Latest local run:

- v0.6 offline multi-turn protocol ledger: `61.23%` aggregate reduction, `61.22%` median reduction, `100%` required-fact fidelity, and zero prompt regressions across 12 long-context cases.
- v0.6 acceptance corpus: 360 deterministic multilingual/code/config pairs with zero false exact classifications; blocking precision, Recall@5, and critical-difference gates pass.
- Smoke coding task: raw `2160` prompt tokens, ShapeLex `699`, about `67.6%` fewer prompt tokens, same required facts and decision.
- End-to-end coding simulation: raw `6573` prompt tokens, ShapeLex lean `2148`, about `67.3%` fewer prompt tokens, same quality score.
- End-to-end with full-mode tool schema included: `4800` loaded tokens, about `26.7%` fewer than raw.
- Agent adoption simulation: ShapeLex was expected in `5` of `6` scenarios and selected in all `5`; it also suggested lean, full, session switch, and cleanup preview in the expected cases.

Real savings depend on the size of the context, the active MCP toolset, the AI app, and whether the agent follows the project instructions. Small tasks may not save tokens, and ShapeLex should skip compression when the handle overhead would cost more than the original text.

## MCP Tools

Lean mode exposes the core workflow tools:

- `shapelex_compress_messages`
- `shapelex_compress_text`
- `shapelex_context`
- `shapelex_expand`
- `shapelex_memory_overview`
- `shapelex_clear`
- `shapelex_prune`

Full mode adds one compact `shapelex_inspect` tool for lower-level search, retrieve, explain, risk, and stats actions without exposing a large separate debug tool list.

## Security

See [SECURITY.md](SECURITY.md). ShapeLex uses a package `files` allowlist so npm publishing does not include local stores, caches, dependencies, private research notes, or generated local files.

## Español

ShapeLex es un servidor MCP local de memoria para herramientas de IA. Ayuda a que las sesiones largas usen menos tokens de entrada guardando contexto viejo en tu computadora y dándole a la IA enlaces compactos `sx://` que puede expandir cuando necesita el texto exacto.

Puedes usar ShapeLex con herramientas que soportan MCP, como Codex, Claude Code y Cursor.

ShapeLex está diseñado para funcionar localmente:

- Guarda memoria exacta en tu computadora.
- No llama a otro modelo de IA.
- No usa APIs de embeddings.
- No tiene dependencias npm en runtime.
- No reemplaza el texto exacto cuando los detalles importan.

ShapeLex principalmente ahorra tokens de entrada. Reduce el contexto viejo que el modelo tiene que volver a leer. No acorta automáticamente la respuesta final del modelo; para ahorrar tokens de salida, pide respuestas breves y directas.

Después de configurarlo, ShapeLex debe ser guiado por el agente. No deberías tener que decir "usa ShapeLex" todo el tiempo. Agrega la instrucción persistente de [docs/AGENT_INSTRUCTIONS.md](docs/AGENT_INSTRUCTIONS.md) a tu app de IA o reglas del proyecto cuando sea posible; así el agente decide cuándo ShapeLex ayuda, te avisa brevemente la primera vez que comprime contexto y mantiene los comandos manuales como alternativa.

El agente también debe guiar la higiene de memoria. Debe recomendar modo lean para el trabajo normal, sugerir modo full solo para inspección más profunda, sugerir una sesión nueva cuando cambie el proyecto o la tarea, y sugerir limpieza cuando la memoria esté vieja, ruidosa, mezclada o confusa. La limpieza debe mostrarse primero como vista previa y confirmarse antes de borrar memoria.

## Instalación

Primero necesitas Node.js. Node incluye `npm` y `npx`, que son los comandos usados para ejecutar ShapeLex.

1. Instala Node.js desde [nodejs.org](https://nodejs.org/).
2. Elige la versión LTS, a menos que sepas que necesitas otra versión.
3. Abre una terminal.
   - Windows: PowerShell o Windows Terminal.
   - macOS: Terminal.
   - Linux: tu terminal normal.
4. Revisa que Node y npm funcionen:

```bash
node --version
npm --version
```

5. Revisa que ShapeLex pueda ejecutarse:

```bash
npx -y shapelex-mcp --doctor
```

Si el doctor muestra `Result: ready`, ShapeLex está listo.

Normalmente no necesitas instalar ShapeLex de forma global. `npx -y shapelex-mcp` descarga y ejecuta el paquete publicado en npm cuando tu herramienta de IA inicia el servidor MCP.

## Inicio Rápido

Prueba manual:

```bash
npx -y shapelex-mcp --doctor
```

Iniciar el servidor MCP manualmente:

```bash
npx -y shapelex-mcp
```

La mayoría de usuarios no necesita iniciarlo manualmente. Codex, Claude Code o Cursor lo inician desde su configuración MCP.

## Configuración De Apps De IA

ShapeLex funciona como servidor MCP. Cada app de IA necesita saber qué comando inicia ShapeLex.

Comando recomendado:

```bash
npx -y shapelex-mcp
```

ShapeLex usa el modo lean por defecto porque es el modo normal para ahorrar tokens. Usa `SHAPELEX_TOOLSET=full` solo cuando quieras la herramienta compacta `shapelex_inspect` para acciones de búsqueda, recuperación, explicación, riesgo y estadísticas.

En el uso normal, deja que el agente recomiende el modo. Debería mantenerte en lean salvo que full ayude a inspeccionar la memoria con más detalle.

### Codex

En un proyecto de Codex, configura un servidor MCP llamado `shapelex` que ejecute:

```bash
npx -y shapelex-mcp
```

Variable recomendada:

```text
SHAPELEX_STORE_DIR=.shapelex-codex
```

Después abre una tarea nueva en Codex y pregunta:

```text
Use ShapeLex memory overview. What memory session am I using?
```

### Claude Code

Ejecuta este comando dentro de la carpeta de tu proyecto:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 shapelex -- npx -y shapelex-mcp
```

En Windows, si Claude Code no puede abrir `npx` directamente, usa:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 shapelex -- cmd /c npx -y shapelex-mcp
```

Verifica:

```bash
claude mcp list
```

### Cursor

Crea o edita `.cursor/mcp.json` dentro de tu proyecto:

```json
{
  "mcpServers": {
    "shapelex": {
      "command": "npx",
      "args": ["-y", "shapelex-mcp"],
      "env": {
        "SHAPELEX_STORE_DIR": ".shapelex-cursor"
      }
    }
  }
}
```

Reinicia Cursor o recarga la ventana. En el chat de Cursor, pregunta:

```text
Use ShapeLex memory overview. What memory session am I using?
```

Instrucciones completas:

- Inglés: [docs/USAGE.md](docs/USAGE.md)
- Español: [docs/USAGE.es.md](docs/USAGE.es.md)

Si la configuración se siente confusa, copia el prompt de ayuda de [docs/AGENT_SETUP_PROMPT.md](docs/AGENT_SETUP_PROMPT.md) en Codex, Claude Code o Cursor y pídele al agente que te guíe.

Para mejores resultados, agrega también la regla de agente de [docs/AGENT_INSTRUCTIONS.md](docs/AGENT_INSTRUCTIONS.md). Esa regla le dice a la IA que use ShapeLex proactivamente en sesiones largas en vez de esperar a que tú lo recuerdes.

## Resultados De Simulación

Antes de publicar, el repo se probó con simulaciones determinísticas comparando contexto raw contra contexto con ShapeLex. Estas pruebas no llaman a un modelo de IA real; comparan tamaño del prompt, hechos retenidos y checks de código generado en escenarios repetibles.

Última ejecución local:

- Smoke test de código: raw `2160` tokens de prompt, ShapeLex `699`, aproximadamente `67.6%` menos tokens de prompt, con los mismos hechos requeridos y la misma decisión.
- Simulación end-to-end: raw `6573` tokens de prompt, ShapeLex lean `2148`, aproximadamente `67.3%` menos tokens de prompt, con la misma calidad.
- End-to-end incluyendo el schema de herramientas en modo full: `4800` tokens cargados, aproximadamente `26.7%` menos que raw.
- Simulación de adopción por agente: se esperaba ShapeLex en `5` de `6` escenarios y se eligió en los `5`; también sugirió lean, full, cambio de sesión y vista previa de limpieza en los casos esperados.

Estos números son ejemplos de la suite determinística, no una promesa universal. El ahorro real depende del tamaño del contexto, el toolset activo, la app de IA y si el agente sigue las instrucciones del proyecto. En tareas pequeñas puede no haber ahorro.

## Privacidad

La memoria local de ShapeLex puede contener texto privado exacto. ShapeLex agrega automáticamente carpetas locales `.shapelex*` al `.gitignore` cuando inicia dentro de un repo git. Aun así, no subas estas carpetas a GitHub:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

Este repositorio ya ignora esas carpetas con `.gitignore`, y ShapeLex agrega carpetas locales equivalentes automáticamente en proyectos nuevos.

## Project Links / Enlaces Del Proyecto

- Package / Paquete: [shapelex-mcp on npm](https://www.npmjs.com/package/shapelex-mcp)
- Releases / Versiones: [GitHub Releases](https://github.com/AldoDior/shapelex/releases)
- Support / Ayuda: [GitHub Issues](https://github.com/AldoDior/shapelex/issues)
- License / Licencia: [MIT](LICENSE)
- Maintainer / Mantenedor: [AldoDior on GitHub](https://github.com/AldoDior) · [LinkedIn](https://www.linkedin.com/in/aldo-diaz-ortega/)
