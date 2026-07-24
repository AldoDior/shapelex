# Guía De Uso De ShapeLex

Esta guía está escrita para personas que no necesariamente tienen experiencia técnica. Si ya sabes usar Node, npm y MCP, puedes ir directo a la sección de tu app: Codex, Claude Code o Cursor.

ShapeLex es un servidor MCP local. En palabras simples: ayuda a que una herramienta de IA recuerde contexto viejo sin tener que pegar todo ese texto otra vez en cada mensaje. Después de configurarlo, debe ser guiado por el agente: la IA decide cuándo usarlo, usa contexto compacto primero y expande texto exacto cuando los detalles importan.

## Qué Necesitas

Necesitas tres cosas:

1. Una computadora con Node.js instalado.
2. Una herramienta de IA que soporte MCP, como Codex, Claude Code o Cursor.
3. El paquete npm `shapelex-mcp`.

No necesitas crear una cuenta de npm para usar ShapeLex. La cuenta de npm solo hace falta si quieres publicar un paquete.

## Paso 1: Instalar Node.js

1. Abre [nodejs.org](https://nodejs.org/).
2. Descarga la versión LTS.
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

Si ambos comandos muestran una versión, vas bien.

## Paso 2: Probar ShapeLex

Ejecuta:

```powershell
npx -y shapelex-mcp --doctor
```

Qué significa este comando:

- `npx` ejecuta un paquete de npm sin instalarlo globalmente.
- `-y` acepta la descarga automáticamente.
- `shapelex-mcp` es el nombre del paquete.
- `--doctor` revisa si tu máquina está lista.

Si ves `Result: ready`, ShapeLex funciona.

## Pedir Ayuda A Un Agente

Si configurar MCP se siente confuso, copia el prompt de [docs/AGENT_SETUP_PROMPT.md](AGENT_SETUP_PROMPT.md) en Codex, Claude Code o Cursor. Ese prompt le pide al agente verificar Node.js, configurar ShapeLex de forma segura, evitar subir carpetas `.shapelex*` y probar la configuración.

Después de configurarlo, agrega la instrucción persistente de [docs/AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) si tu app de IA soporta instrucciones de proyecto, reglas o memoria. Esa instrucción le dice al agente que use ShapeLex proactivamente, te avise brevemente la primera vez que comprima contexto y mantenga comandos manuales como alternativa.

## Paso 3: Configurar Tu App De IA

Normalmente no vas a abrir ShapeLex a mano. Tu app de IA lo inicia por ti usando este comando:

```powershell
npx -y shapelex-mcp
```

La configuración recomendada usa:

```text
SHAPELEX_STORE_DIR=.shapelex
```

ShapeLex usa el modo lean por defecto. Eso mantiene pocas herramientas visibles para la IA y ayuda a reducir tokens.

Usa `SHAPELEX_TOOLSET=full` solo si quieres la herramienta compacta `shapelex_inspect` para acciones de búsqueda, recuperación, explicación, riesgo y estadísticas.

`SHAPELEX_STORE_DIR=.shapelex` indica donde se guarda la memoria local.

El comportamiento del agente debe ser simple:

- Mantener lean para trabajo normal de código y memoria de sesiones largas.
- Sugerir full solo cuando lean no alcance para una búsqueda, recuperación, explicación, riesgo o estadística más profunda.
- Sugerir una sesión nueva cuando cambie el proyecto, repo, cliente, feature o tarea.
- Sugerir limpieza cuando la memoria esté vieja, ruidosa, mezclada o confusa.
- Mostrar una vista previa antes de limpiar; no borrar memoria sin confirmación.

## Codex

Usa esta sección si quieres ShapeLex en Codex.

Si estás usando este repositorio directamente, ya existe una configuración en:

```text
.codex/config.toml
```

En un proyecto nuevo, configura Codex para iniciar ShapeLex con este comando:

```text
npx -y shapelex-mcp
```

Usa esta variable:

```text
SHAPELEX_STORE_DIR=.shapelex-codex
```

Ejemplo de configuración MCP para Codex:

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

Para probarlo, abre una tarea nueva en Codex y pregunta una vez:

```text
Use ShapeLex memory overview. What memory session am I using?
```

La respuesta debería decir qué sesión está usando y si hay memoria que limpiar.

## Claude Code

Usa esta sección si quieres ShapeLex en Claude Code.

Para agregar ShapeLex desde npm:

```bash
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- npx -y shapelex-mcp
```

En Windows, si Claude Code no puede abrir `npx` directamente, usa:

```powershell
claude mcp add --transport stdio --env SHAPELEX_STORE_DIR=.shapelex-claude --env SHAPELEX_MAX_STORE_MB=100 --env SHAPELEX_TOOLSET=lean shapelex -- cmd /c npx -y shapelex-mcp
```

Después revisa:

```bash
claude mcp list
```

Dentro de Claude Code también puedes abrir:

```text
/mcp
```

Eso ayuda a confirmar que ShapeLex está conectado.

Después pregunta una vez en Claude Code:

```text
Use ShapeLex memory overview. What memory session am I using?
```

## Cursor

Usa esta sección si quieres ShapeLex en Cursor.

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

En el chat de Cursor, pregunta una vez:

```text
Use ShapeLex memory overview. What memory session am I using?
```

## Cómo Usarlo En Una Sesión Larga

Este debe ser el flujo normal del agente. No deberías tener que pedirlo todo el tiempo.

```text
Use ShapeLex memory overview. What memory session am I using?
```

Después de esa prueba inicial, el agente debe decidir cuándo comprimir contexto viejo. La primera vez que lo haga, debería avisarte brevemente:

```text
Voy a comprimir contexto anterior con ShapeLex para mantener esta sesión más ligera.
```

Cuando un detalle sea importante, el agente debe expandir el texto exacto antes de cambiar código, ejecutar comandos, borrar memoria o depender de números, fechas, negaciones, errores o instrucciones.

El agente también debe sugerir cuándo cambiar de sesión o limpiar memoria. Por ejemplo:

```text
Esto parece otro proyecto. Voy a usar una nueva sesión de ShapeLex para no mezclar memoria.
```

Y antes de borrar memoria:

```text
Esta memoria parece vieja o ruidosa. Voy a mostrar una vista previa de limpieza antes de borrar algo.
```

## Sesiones

Una sesión es como una caja de memoria. Usa una sesión por proyecto o tarea.

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

ShapeLex no borra memoria vieja automáticamente. Esto es intencional, porque borrar una sesión puede romper enlaces `sx://` que el agente todavía necesita expandir.

Para revisar memoria, pide:

```text
Use ShapeLex memory overview. What memory session am I using, and should I clean anything?
```

Para borrar una sesión vieja, usa la herramienta `shapelex_clear` con el `sessionId` correcto.

Para mantener solo las sesiones más recientes, usa `shapelex_prune`.

## Privacidad

ShapeLex guarda texto exacto localmente. Eso puede incluir código privado, instrucciones, notas, logs o texto pegado en una conversación. Cuando ShapeLex inicia dentro de un repo git, agrega automáticamente carpetas locales `.shapelex*` al `.gitignore`.

No subas estas carpetas a GitHub:

```text
.shapelex/
.shapelex-codex/
.shapelex-cursor/
.shapelex-claude/
```

Si guardaste algo privado por error, borra la sesión con `shapelex_clear` o elimina la carpeta local de ShapeLex.

## Probar Desde El Código Fuente

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
4. Usa el modo lean por defecto. Solo cambia a `SHAPELEX_TOOLSET=full` si necesitas `shapelex_inspect`.
5. No subas carpetas `.shapelex*` a GitHub.
