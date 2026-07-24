# Agent Setup Prompt

Copy one of these prompts into Codex, Claude Code, or Cursor if you want the AI agent to help you set up ShapeLex.

## English

```text
I want to set up ShapeLex MCP in this project.

Please help me step by step. Assume I am not technical.

Goal:
- Install or verify Node.js.
- Verify that `npx -y shapelex-mcp --doctor` works.
- Configure ShapeLex as an MCP server for the AI app I am using.
- Use lean mode for normal token-saving usage.
- Make ShapeLex agent-driven by default: after setup, add the persistent instruction from `docs/AGENT_INSTRUCTIONS.md` if my AI app supports project instructions or rules.
- Do not make me manually say "use ShapeLex" every time. The agent should decide when it helps, briefly notify me the first time it compresses context, and still allow manual commands as a fallback.
- Store local ShapeLex memory in a private ignored folder:
  - Codex: `.shapelex-codex`
  - Claude Code: `.shapelex-claude`
  - Cursor: `.shapelex-cursor`
- Do not publish, commit, or upload `.shapelex*` folders.
- ShapeLex should auto-add `.shapelex*` stores to `.gitignore`, but verify that the entry exists.
- After setup, test it by asking ShapeLex memory overview what session is active, then explain that future use should be agent-driven.

Use the correct setup path for my app:
- Codex: configure an MCP server named `shapelex` that runs `npx -y shapelex-mcp`.
- Claude Code: use `claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp`.
- Cursor: create or edit `.cursor/mcp.json` with a `shapelex` MCP server using command `npx` and args `["-y", "shapelex-mcp"]`.

Before changing files, explain what file you will edit and why. After setup, verify with:
`npx -y shapelex-mcp --doctor`
and then ask:
`Use ShapeLex memory overview. What memory session am I using?`
```

## Español

```text
Quiero configurar ShapeLex MCP en este proyecto.

Ayúdame paso a paso. Asume que no soy una persona técnica.

Objetivo:
- Instalar o verificar Node.js.
- Verificar que `npx -y shapelex-mcp --doctor` funcione.
- Configurar ShapeLex como servidor MCP para la app de IA que estoy usando.
- Usar modo lean para el uso normal de ahorro de tokens.
- Hacer que ShapeLex sea guiado por el agente de forma predeterminada: después de configurarlo, agrega la instrucción persistente de `docs/AGENT_INSTRUCTIONS.md` si mi app de IA soporta instrucciones de proyecto o reglas.
- No hacerme decir manualmente "usa ShapeLex" todo el tiempo. El agente debe decidir cuándo ayuda, avisarme brevemente la primera vez que comprima contexto y permitir comandos manuales como alternativa.
- Guardar la memoria local de ShapeLex en una carpeta privada ignorada:
  - Codex: `.shapelex-codex`
  - Claude Code: `.shapelex-claude`
  - Cursor: `.shapelex-cursor`
- No publicar, commitear ni subir carpetas `.shapelex*`.
- ShapeLex debería agregar automáticamente carpetas `.shapelex*` al `.gitignore`, pero verifica que la entrada exista.
- Después de configurarlo, probarlo preguntando a ShapeLex memory overview qué sesión está activa y explicar que el uso futuro debe ser guiado por el agente.

Usa la ruta correcta para mi app:
- Codex: configura un servidor MCP llamado `shapelex` que ejecute `npx -y shapelex-mcp`.
- Claude Code: usa `claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp`.
- Cursor: crea o edita `.cursor/mcp.json` con un servidor MCP `shapelex` usando command `npx` y args `["-y", "shapelex-mcp"]`.

Antes de cambiar archivos, explícame qué archivo vas a editar y por qué. Después de configurarlo, verifica con:
`npx -y shapelex-mcp --doctor`
y luego pregunta:
`Use ShapeLex memory overview. What memory session am I using?`
```
