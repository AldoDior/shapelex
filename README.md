# ShapeLex

[English](#english) | [Español](#español)

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

## Install

You need Node.js first. Node includes `npm` and `npx`, which are the commands used to run ShapeLex.

1. Install Node.js from [nodejs.org](https://nodejs.org/).
2. Choose the LTS version unless you already know you need another version.
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

## How It Works

ShapeLex stores exact source text in a private local store and gives the agent compact handles.

Example handle:

```text
sx://default/doc/abc123/span/def456
```

That handle is a pointer. It is not the full text. If exact wording, numbers, code, commands, negations, or user instructions matter, the agent should expand the handle before relying on it.

ShapeLex gives agents a hierarchy:

- Level 0: short summary.
- Level 1: semantic map.
- Level 2: anchors and fingerprints.
- Level 3: exact critical extracts.
- Level 4: exact expandable handles.

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
npm run smoke
npm run e2e
npm run benchmark
```

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

## Privacidad

La memoria local de ShapeLex puede contener texto privado exacto. ShapeLex agrega automáticamente carpetas locales `.shapelex*` al `.gitignore` cuando inicia dentro de un repo git. Aun así, no subas estas carpetas a GitHub:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

Este repositorio ya ignora esas carpetas con `.gitignore`, y ShapeLex agrega carpetas locales equivalentes automáticamente en proyectos nuevos.
