# Guía Rápida De ShapeLex

[English](QUICKSTART.md)

Esta guía está dirigida a personas que quieren usar ShapeLex con Codex, Cursor o Claude Code sin tener que comprender los detalles internos de MCP.

ShapeLex es una capa de memoria local para sesiones largas con IA. Permite que el agente recupere primero contexto compacto y expanda el texto exacto solamente cuando los detalles importan.

## Qué Hace ShapeLex

- Mantiene el texto fuente exacto disponible mediante enlaces expandibles `sx://`.
- Reduce contexto de entrada repetido en sesiones largas.
- Reconoce texto registrado exacto, trasladado, reorganizado o estrechamente relacionado.
- Comprueba los bytes UTF-8 y un SHA-256 completo antes de declarar una coincidencia exacta.
- Protege números, fechas, negaciones, comandos, operadores, código e instrucciones explícitas.
- Construye el índice limitado de huellas bajo demanda y en memoria, sin crear una base de datos de huellas.
- Omite la compresión cuando la representación compacta no ahorraría tokens.

ShapeLex no reemplaza el texto fuente exacto. Cuando importen las palabras, el código, los números, las fechas o las instrucciones, el agente debe expandir el enlace correspondiente antes de actuar.

## Requisitos

Necesitas:

1. Node.js 22 o posterior.
2. Codex, Cursor o Claude Code.
3. Una carpeta de proyecto donde quieras guardar la memoria de ShapeLex.

Comprueba Node.js:

```bash
node --version
npm --version
```

Comprueba la última versión publicada de ShapeLex:

```bash
npx -y shapelex-mcp@latest --doctor
```

El resultado esperado incluye:

```text
Result: ready
```

La versión mostrada debe coincidir con la versión actual publicada en npm.

Si ejecutas el doctor desde el propio repositorio fuente de ShapeLex, usa `npm run doctor`. Ejecuta el comando `npx` desde el proyecto donde utilizarás ShapeLex.

## La Opción Más Fácil: Pídeselo Al Agente

Abre el proyecto en Codex, Cursor o Claude Code y pega este prompt:

```text
Configura o actualiza ShapeLex MCP en este proyecto.

Asume que no soy una persona técnica y realiza directamente la configuración segura.

Requisitos:
- Detecta si estoy usando Codex, Cursor o Claude Code y usa la configuración correcta para esa app.
- Verifica Node.js 22 o posterior.
- Comprueba la última versión publicada con:
  npx -y shapelex-mcp@latest --doctor
- Inspecciona cualquier configuración existente de ShapeLex antes de editarla.
- Si SHAPELEX_STORE_DIR ya existe, conserva exactamente su valor para mantener disponible la memoria anterior.
- Si es una instalación nueva, usa:
  - .shapelex-codex para Codex
  - .shapelex-cursor para Cursor
  - .shapelex-claude para Claude Code
- Configura SHAPELEX_TOOLSET=lean y SHAPELEX_MAX_STORE_MB=100.
- Conserva todos los servidores MCP y ajustes que no pertenezcan a ShapeLex.
- Conserva las instrucciones existentes del proyecto y añade el flujo de ShapeLex sin sobrescribir indicaciones ajenas.
- No borres ni edites manualmente archivos de memoria de ShapeLex.
- No configures SHAPELEX_PERSIST=0 porque quiero memoria entre sesiones.
- Verifica que Git ignore .shapelex*.
- Añade las instrucciones persistentes de ShapeLex al archivo correcto:
  - Codex: AGENTS.md
  - Cursor: .cursor/rules/shapelex.mdc
  - Claude Code: CLAUDE.md
- No ejecutes las suites de pruebas, mutación, tortura ni benchmarks de ShapeLex.
- Dime qué archivos cambiaste y pídeme reiniciar o recargar la app.
- Después del reinicio, verifica la conexión MCP con shapelex_memory_overview.

Usa el comando normal sin versión fija en la configuración MCP final:
  npx -y shapelex-mcp

En Windows nativo, usa cmd /c si la app no puede iniciar npx directamente.
```

El agente debe explicar qué editará, conservar la memoria existente y no tocar configuraciones ajenas.

## Configuración Manual

Elige la app que utilizas. Solo necesitas una de las siguientes secciones.

### Codex

Codex puede guardar la configuración MCP globalmente en `~/.codex/config.toml` o dentro de un proyecto de confianza en `.codex/config.toml`.

Añade:

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

Alternativa para Windows nativo:

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

Reinicia Codex. Usa `/mcp` o `codex mcp list` para confirmar que `shapelex` está conectado.

Para que el agente lo use automáticamente, añade las instrucciones de [Hacer Que ShapeLex Sea Automático](#hacer-shapelex-automatico) al archivo `AGENTS.md` ubicado en la raíz del proyecto.

### Cursor

Crea o edita `.cursor/mcp.json` dentro del proyecto:

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

Alternativa para Windows nativo:

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

Conserva los demás servidores que ya existan dentro de `mcpServers`. Reinicia Cursor o recarga la ventana después de guardar.

Para que el agente lo use automáticamente, crea `.cursor/rules/shapelex.mdc` y añade las instrucciones de [Hacer Que ShapeLex Sea Automático](#hacer-shapelex-automatico). Empieza el archivo con:

```markdown
---
description: Usa ShapeLex proactivamente como memoria para sesiones largas.
globs:
alwaysApply: true
---
```

### Claude Code

Ejecuta este comando dentro del proyecto:

```bash
claude mcp add --scope local \
  --env SHAPELEX_STORE_DIR=.shapelex-claude \
  --env SHAPELEX_MAX_STORE_MB=100 \
  --env SHAPELEX_TOOLSET=lean \
  --transport stdio shapelex -- npx -y shapelex-mcp
```

Windows nativo:

```powershell
claude mcp add --scope local --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean --transport stdio shapelex -- cmd /c npx -y shapelex-mcp
```

Comprueba la conexión:

```bash
claude mcp list
```

También puedes usar `/mcp` dentro de Claude Code. Si eliges alcance de proyecto en lugar de alcance local, Claude Code escribe `.mcp.json` y solicita que apruebes el servidor del proyecto.

Para que el agente lo use automáticamente, añade las instrucciones de [Hacer Que ShapeLex Sea Automático](#hacer-shapelex-automatico) al archivo `CLAUDE.md` ubicado en la raíz del proyecto.

<a id="hacer-shapelex-automatico"></a>

## Hacer Que ShapeLex Sea Automático

Añade esta instrucción al archivo de instrucciones persistentes correspondiente:

```markdown
## Memoria de ShapeLex

- Usa ShapeLex proactivamente para contexto largo pegado en el chat, notas repetidas del proyecto, historial anterior, documentos extensos, logs y fragmentos de código.
- Avísame brevemente la primera vez que comprimas contexto en una sesión. No repitas el aviso en cada llamada.
- Usa un `sessionId` claro por proyecto o tarea.
- Empieza con `shapelex_memory_overview` cuando importe conocer el estado de la memoria.
- Cuando el contenido relevante ya exista en un archivo del proyecto, prefiere `shapelex_compress_text` con `sourcePath`.
- Usa `shapelex_context` antes de volver a cargar memoria anterior en el prompt.
- Expande los enlaces `sx://` antes de depender de palabras exactas, números, fechas, negaciones, instrucciones, código, errores, comandos o decisiones.
- Si ShapeLex devuelve `compressionSkipped: true`, usa el texto exacto devuelto en lugar de forzar la compresión.
- Mantén `SHAPELEX_TOOLSET=lean` para el trabajo normal. Sugiere el modo full solamente para una inspección más profunda.
- Sugiere una sesión nueva cuando cambie el proyecto o la tarea.
- Muestra una vista previa de la limpieza y pide permiso antes de borrar memoria.
```

Ubicación para cada app:

| App | Instrucciones persistentes |
| --- | --- |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/shapelex.mdc` |
| Claude Code | `CLAUDE.md` |

## Confirmar Que Funciona

Después de reiniciar o recargar la app, pregunta:

```text
Usa el resumen de memoria de ShapeLex. ¿Qué sesión de memoria estamos utilizando?
```

Para una tarea nueva:

```text
Usa ShapeLex para esta tarea larga. Utiliza el sessionId autenticacion-portal-cliente.
```

Para recuperar decisiones anteriores:

```text
Usa ShapeLex para recuperar el contexto relevante de nuestras decisiones anteriores sobre autenticación.
```

Antes de actuar sobre detalles exactos:

```text
Expande cualquier enlace de ShapeLex que contenga requisitos, números, comandos, errores, fechas o decisiones exactas antes de hacer cambios.
```

## Actualizar Desde Una Versión Anterior

1. No borres el directorio `.shapelex*` existente.
2. Conserva el valor actual de `SHAPELEX_STORE_DIR`.
3. Ejecuta `npx -y shapelex-mcp@latest --doctor`.
4. Mantén `npx -y shapelex-mcp` como comando MCP normal.
5. Reinicia o recarga la app de IA.
6. Solicita `shapelex_memory_overview`.

ShapeLex migra los stores anteriores compatibles después del siguiente cambio de memoria guardado correctamente. No edites manualmente el JSON del store.

## Privacidad Y Limpieza

ShapeLex guarda texto exacto localmente. Ese texto puede contener código privado, instrucciones, logs o material pegado en el chat.

Comprueba que Git ignore:

```gitignore
.shapelex*
```

Usa `shapelex_memory_overview` para revisar la memoria. Muestra una vista previa antes de usar `shapelex_clear` o `shapelex_prune`. No borres un store únicamente porque falle la conexión MCP; primero corrige la configuración.

## Solución De Problemas

### El comando doctor no se reconoce

- Confirma que `node --version` muestre Node.js 22 o posterior.
- Cierra y vuelve a abrir la terminal después de instalar Node.js.
- En Windows, prueba `npx.cmd -y shapelex-mcp@latest --doctor`.
- Si estás dentro del repositorio fuente de ShapeLex, usa `npm run doctor`.

### El servidor MCP no aparece

- Reinicia Codex, recarga Cursor o reinicia Claude Code.
- Revisa el archivo de configuración correspondiente a la app.
- En Windows nativo, usa la alternativa con `cmd /c`.
- Conserva `SHAPELEX_STORE_DIR` mientras diagnosticas.

### Parece que la memoria anterior desapareció

Compara los valores anterior y actual de `SHAPELEX_STORE_DIR`. Un directorio diferente crea un store separado; no significa que la memoria anterior haya sido eliminada.

### Una tarea corta no ahorra tokens

Puede ser el comportamiento correcto. ShapeLex omite la compresión cuando la representación compacta costaría más que el texto original.

## Más Documentación

- [Referencia de uso completa](USAGE.es.md)
- [Prompt de configuración para agentes](AGENT_SETUP_PROMPT.md)
- [Instrucciones completas para agentes](AGENT_INSTRUCTIONS.md)
- [Política de seguridad](../SECURITY.md)

Referencias oficiales de las apps:

- [MCP en Codex](https://learn.chatgpt.com/docs/extend/mcp)
- [AGENTS.md en Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [MCP en Cursor](https://docs.cursor.com/context/model-context-protocol)
- [Reglas de Cursor](https://docs.cursor.com/context/rules)
- [MCP en Claude Code](https://code.claude.com/docs/en/mcp)
- [Memoria y CLAUDE.md en Claude Code](https://code.claude.com/docs/en/memory)
