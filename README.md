# ShapeLex

[English](#english) | [Espanol](#espanol)

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

For full setup instructions, see:

- English: [docs/USAGE.md](docs/USAGE.md)
- Spanish: [docs/USAGE.es.md](docs/USAGE.es.md)

Recommended MCP command for most tools:

```bash
npx -y shapelex-mcp
```

Recommended environment variables:

```text
SHAPELEX_TOOLSET=lean
SHAPELEX_STORE_DIR=.shapelex
```

Use `SHAPELEX_TOOLSET=lean` for Codex, Claude Code, and Cursor. Lean mode exposes the normal low-overhead tools and avoids loading debug tools into the model context.

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

Local ShapeLex memory may contain exact private text. Do not commit or publish these folders:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

This repo ignores those folders with `.gitignore`.

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

Full mode also exposes lower-level search, retrieve, explain, risk, and stats tools.

## Security

See [SECURITY.md](SECURITY.md). ShapeLex uses a package `files` allowlist so npm publishing does not include local stores, caches, dependencies, private research notes, or generated local files.

## Espanol

ShapeLex es un servidor MCP local de memoria para herramientas de IA. Ayuda a que las sesiones largas usen menos tokens de entrada guardando contexto viejo en tu computadora y dandole a la IA enlaces compactos `sx://` que puede expandir cuando necesita el texto exacto.

Puedes usar ShapeLex con herramientas que soportan MCP, como Codex, Claude Code y Cursor.

ShapeLex esta disenado para funcionar localmente:

- Guarda memoria exacta en tu computadora.
- No llama a otro modelo de IA.
- No usa APIs de embeddings.
- No tiene dependencias npm en runtime.
- No reemplaza el texto exacto cuando los detalles importan.

ShapeLex principalmente ahorra tokens de entrada. Reduce el contexto viejo que el modelo tiene que volver a leer. No acorta automaticamente la respuesta final del modelo; para ahorrar tokens de salida, pide respuestas breves y directas.

## Instalacion

Primero necesitas Node.js. Node incluye `npm` y `npx`, que son los comandos usados para ejecutar ShapeLex.

1. Instala Node.js desde [nodejs.org](https://nodejs.org/).
2. Elige la version LTS, a menos que sepas que necesitas otra version.
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

Si el doctor muestra `Result: ready`, ShapeLex esta listo.

Normalmente no necesitas instalar ShapeLex de forma global. `npx -y shapelex-mcp` descarga y ejecuta el paquete publicado en npm cuando tu herramienta de IA inicia el servidor MCP.

## Inicio Rapido

Prueba manual:

```bash
npx -y shapelex-mcp --doctor
```

Iniciar el servidor MCP manualmente:

```bash
npx -y shapelex-mcp
```

La mayoria de usuarios no necesita iniciarlo manualmente. Codex, Claude Code o Cursor lo inician desde su configuracion MCP.

## Configuracion De Apps De IA

Instrucciones completas:

- Ingles: [docs/USAGE.md](docs/USAGE.md)
- Espanol: [docs/USAGE.es.md](docs/USAGE.es.md)

Comando MCP recomendado para la mayoria de herramientas:

```bash
npx -y shapelex-mcp
```

Variables recomendadas:

```text
SHAPELEX_TOOLSET=lean
SHAPELEX_STORE_DIR=.shapelex
```

Usa `SHAPELEX_TOOLSET=lean` para Codex, Claude Code y Cursor. Lean mode expone las herramientas normales y evita cargar herramientas de debug en el contexto del modelo.

## Privacidad

La memoria local de ShapeLex puede contener texto privado exacto. No subas estas carpetas a GitHub:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

Este repositorio ya ignora esas carpetas con `.gitignore`.
