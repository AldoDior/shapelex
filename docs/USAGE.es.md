# Guia De Uso De ShapeLex

ShapeLex es un servidor MCP local que ayuda a reducir tokens de entrada en sesiones largas con herramientas de IA como Codex, Claude Code y Cursor.

La idea simple: ShapeLex guarda texto exacto en tu maquina y le da al agente enlaces compactos `sx://`. El agente puede usar esos enlaces para buscar, resumir o recuperar el texto exacto cuando un detalle importa.

ShapeLex no manda tu memoria a la nube. El almacenamiento local se queda en una carpeta como `.shapelex/`, `.shapelex-codex/`, `.shapelex-cursor/` o `.shapelex-claude/`. Esas carpetas no se deben subir a GitHub.

## Instalacion Rapida

Primero revisa que Node.js funcione y que ShapeLex pueda arrancar:

```powershell
npx -y shapelex-mcp --doctor
```

Para iniciar el servidor MCP manualmente:

```powershell
npx -y shapelex-mcp
```

Normalmente no vas a ejecutar ese segundo comando a mano. Codex, Claude Code o Cursor lo ejecutan por ti cuando configuras el MCP.

## Que Guarda ShapeLex

ShapeLex guarda texto exacto localmente para poder expandir un enlace `sx://` despues.

Ejemplo:

```text
sx://default/doc/abc123/span/def456
```

Ese enlace no contiene todo el texto. Es un puntero. Por eso existe el almacenamiento local.

## Que Tokens Ahorra

ShapeLex principalmente ahorra tokens de entrada. Eso significa que evita pegar todo el contexto viejo una y otra vez en el prompt.

ShapeLex no comprime automaticamente la respuesta que escribe el modelo. Para ahorrar tokens de salida, pide respuestas cortas y directas. El skill incluido ya recomienda eso.

## Regla Practica

Usa una sesion por proyecto o tarea.

Buenos nombres:

```text
inventario-papa
shapelex-docs
portal-cliente
```

Evita usar siempre:

```text
default
```

Usar `default` para todo funciona, pero mezcla memoria de proyectos diferentes y hace mas dificil limpiar o buscar.

## Codex

Este repositorio incluye configuracion local para Codex:

```text
.codex/config.toml
```

Si instalaste desde npm en otro proyecto, configura el servidor MCP para ejecutar:

```text
npx -y shapelex-mcp
```

Luego abre una tarea nueva de Codex y pregunta:

```text
Use ShapeLex memory overview. What memory session am I using?
```

El agente deberia responder que sesion esta usando y si hay algo que limpiar.

## Claude Code

Para agregar ShapeLex desde npm:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp
```

En Windows, si Claude Code no puede abrir `npx` directamente, usa:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- cmd /c npx -y shapelex-mcp
```

Despues usa:

```bash
claude mcp list
```

Tambien puedes abrir `/mcp` dentro de Claude Code para revisar que ShapeLex este conectado.

## Cursor

En Cursor puedes usar `.cursor/mcp.json` dentro del proyecto.

Configuracion recomendada:

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

En el chat de Cursor pregunta:

```text
Use ShapeLex memory overview. What memory session am I using?
```

## Limpieza De Memoria

ShapeLex no borra memoria vieja automaticamente. Esto es intencional, porque borrar una sesion puede romper enlaces `sx://` que el agente todavia necesita expandir.

Para revisar memoria, pide al agente:

```text
Use ShapeLex memory overview. What memory session am I using, and should I clean anything?
```

Para borrar una sesion vieja, usa la herramienta `shapelex_clear` con el `sessionId` correcto.

Para mantener solo las sesiones mas recientes, usa `shapelex_prune`.

## Privacidad

No subas estas carpetas a GitHub:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

Este repositorio ya las ignora con `.gitignore`, pero es bueno saberlo.

Si guardaste algo privado por error, borra la sesion con `shapelex_clear` o elimina la carpeta local de ShapeLex.

## Probar Que Todo Funciona

En un proyecto donde tengas ShapeLex instalado, ejecuta:

```powershell
npx -y shapelex-mcp --doctor
```

Si estas trabajando desde el codigo fuente del repositorio:

```powershell
npm install
npm run check
```

`npm run check` corre doctor, typecheck, lint, tests, smoke test, eval end-to-end y benchmark.

## Resumen

Usa ShapeLex cuando una sesion de IA se vuelve larga y no quieres pegar todo el contexto viejo otra vez.

Cuando un detalle sea importante, el agente debe expandir el `sx://` para leer el texto exacto.

