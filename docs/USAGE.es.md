# Guia De Uso De ShapeLex

Esta guia esta escrita para personas que no necesariamente tienen experiencia tecnica. Si ya sabes usar Node, npm y MCP, puedes ir directo a la seccion de tu app: Codex, Claude Code o Cursor.

ShapeLex es un servidor MCP local. En palabras simples: ayuda a que una herramienta de IA recuerde contexto viejo sin tener que pegar todo ese texto otra vez en cada mensaje.

## Que Necesitas

Necesitas tres cosas:

1. Una computadora con Node.js instalado.
2. Una herramienta de IA que soporte MCP, como Codex, Claude Code o Cursor.
3. El paquete npm `shapelex-mcp`.

No necesitas crear una cuenta de npm para usar ShapeLex. La cuenta de npm solo hace falta si quieres publicar un paquete.

## Paso 1: Instalar Node.js

1. Abre [nodejs.org](https://nodejs.org/).
2. Descarga la version LTS.
3. Instala Node.js con las opciones normales del instalador.
4. Cierra y vuelve a abrir tu terminal.

Terminal recomendada:

- Windows: PowerShell o Windows Terminal.
- macOS: Terminal.
- Linux: tu terminal normal.

Verifica que Node y npm funcionen:

```powershell
node --version
npm --version
```

Si ambos comandos muestran una version, vas bien.

## Paso 2: Probar ShapeLex

Ejecuta:

```powershell
npx -y shapelex-mcp --doctor
```

Que significa este comando:

- `npx` ejecuta un paquete de npm sin instalarlo globalmente.
- `-y` acepta la descarga automaticamente.
- `shapelex-mcp` es el nombre del paquete.
- `--doctor` revisa si tu maquina esta lista.

Si ves `Result: ready`, ShapeLex funciona.

## Paso 3: Configurar Tu App De IA

Normalmente no vas a abrir ShapeLex a mano. Tu app de IA lo inicia por ti usando este comando:

```powershell
npx -y shapelex-mcp
```

La configuracion recomendada usa:

```text
SHAPELEX_TOOLSET=lean
SHAPELEX_STORE_DIR=.shapelex
```

`SHAPELEX_TOOLSET=lean` mantiene pocas herramientas visibles para la IA. Esto ayuda a reducir tokens.

`SHAPELEX_STORE_DIR=.shapelex` indica donde se guarda la memoria local.

## Codex

Si estas usando este repositorio directamente, ya existe una configuracion en:

```text
.codex/config.toml
```

En un proyecto nuevo, configura Codex para iniciar ShapeLex con:

```text
npx -y shapelex-mcp
```

Usa estas variables:

```text
SHAPELEX_TOOLSET=lean
SHAPELEX_STORE_DIR=.shapelex-codex
```

Para probarlo, abre una tarea nueva en Codex y pregunta:

```text
Use ShapeLex memory overview. What memory session am I using?
```

La respuesta deberia decir que sesion esta usando y si hay memoria que limpiar.

## Claude Code

Para agregar ShapeLex desde npm:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp
```

En Windows, si Claude Code no puede abrir `npx` directamente, usa:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- cmd /c npx -y shapelex-mcp
```

Despues revisa:

```bash
claude mcp list
```

Dentro de Claude Code tambien puedes abrir:

```text
/mcp
```

Eso ayuda a confirmar que ShapeLex esta conectado.

## Cursor

En Cursor, crea o edita este archivo dentro de tu proyecto:

```text
.cursor/mcp.json
```

Contenido recomendado:

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

Luego reinicia Cursor o recarga la ventana.

En el chat de Cursor pregunta:

```text
Use ShapeLex memory overview. What memory session am I using?
```

## Como Usarlo En Una Sesion Larga

Pide al agente que use ShapeLex cuando el contexto empiece a crecer:

```text
Use ShapeLex to compress the older context and keep only what you need for the next task.
```

Cuando un detalle sea importante, pide que expanda el texto exacto:

```text
Before changing code, expand the relevant ShapeLex handles and verify exact requirements.
```

## Sesiones

Una sesion es como una caja de memoria. Usa una sesion por proyecto o tarea.

Buenos nombres:

```text
inventory-app
shapelex-docs
client-portal
```

Evita usar siempre:

```text
default
```

Usar `default` para todo mezcla memoria de proyectos diferentes.

## Limpieza De Memoria

ShapeLex no borra memoria vieja automaticamente. Esto es intencional, porque borrar una sesion puede romper enlaces `sx://` que el agente todavia necesita expandir.

Para revisar memoria, pide:

```text
Use ShapeLex memory overview. What memory session am I using, and should I clean anything?
```

Para borrar una sesion vieja, usa la herramienta `shapelex_clear` con el `sessionId` correcto.

Para mantener solo las sesiones mas recientes, usa `shapelex_prune`.

## Privacidad

ShapeLex guarda texto exacto localmente. Eso puede incluir codigo privado, instrucciones, notas, logs o texto pegado en una conversacion.

No subas estas carpetas a GitHub:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

Si guardaste algo privado por error, borra la sesion con `shapelex_clear` o elimina la carpeta local de ShapeLex.

## Probar Desde El Codigo Fuente

Esto solo es necesario si quieres contribuir al proyecto o modificar ShapeLex.

```powershell
git clone https://github.com/AldoDior/shapelex.git
cd shapelex
npm install
npm run check
```

`npm run check` corre doctor, typecheck, lint, tests, smoke test, eval end-to-end y benchmark.

## Resumen

1. Instala Node.js.
2. Prueba `npx -y shapelex-mcp --doctor`.
3. Configura tu app de IA para ejecutar `npx -y shapelex-mcp`.
4. Usa `SHAPELEX_TOOLSET=lean`.
5. No subas carpetas `.shapelex*` a GitHub.
