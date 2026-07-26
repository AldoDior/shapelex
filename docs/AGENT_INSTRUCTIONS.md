# ShapeLex Agent Instructions

Use this as a persistent project instruction in Codex, Claude Code, Cursor, or any agent that can use the ShapeLex MCP server.

## English

ShapeLex should be agent-driven by default. Use ShapeLex proactively for long pasted context, repeated project notes, older conversation history, large docs, logs, or code snippets. Do not wait for me to say "use ShapeLex".

When relevant content already exists in a workspace file, prefer `shapelex_compress_text` with `sourcePath` instead of sending the file again as `text`. This keeps exact expansion checksum-verified without storing another full source copy.

Briefly tell me the first time you use ShapeLex in a session, for example: "I am going to compress older context with ShapeLex to keep this session lighter." Do not repeat this for every ShapeLex call.

Use one readable `sessionId` per project or task. Start with `shapelex_memory_overview` when memory state matters. Use `shapelex_context` before reloading old memory into the prompt. Expand `sx://` handles before relying on exact wording, numbers, dates, negations, user instructions, code, errors, commands, or decisions. If ShapeLex says compression was skipped, use the exact returned text instead of forcing handles.

Recommend lean mode for normal work. Suggest full mode only when deeper search, retrieve, explain, risk, or stats actions are needed. Suggest a new readable `sessionId` when the project, repo, client, feature, or task changes. Suggest cleanup when memory is old, noisy, unrelated, or confusing; preview cleanup first and ask before deleting memory.

Keep chat output brief. Spend tokens on code, tests, exact results, blockers, and next steps.

Manual commands like "use ShapeLex" or "show ShapeLex memory overview" should still work, but they are a fallback, not the normal workflow.

## Español

ShapeLex debe ser guiado por el agente de forma predeterminada. Usa ShapeLex proactivamente cuando haya contexto largo pegado en el chat, notas repetidas del proyecto, historial viejo de conversación, documentos grandes, logs o fragmentos de código. No esperes a que yo diga "usa ShapeLex".

Avísame brevemente la primera vez que uses ShapeLex en una sesión, por ejemplo: "Voy a comprimir contexto anterior con ShapeLex para mantener esta sesión más ligera." No repitas este aviso en cada llamada a ShapeLex.

Usa un `sessionId` claro por proyecto o tarea. Empieza con `shapelex_memory_overview` cuando importe saber el estado de la memoria. Usa `shapelex_context` antes de volver a cargar memoria vieja en el prompt. Expande los enlaces `sx://` antes de depender de texto exacto, números, fechas, negaciones, instrucciones del usuario, código, errores, comandos o decisiones. Si ShapeLex dice que omitió la compresión, usa el texto exacto devuelto en vez de forzar enlaces.

Recomienda el modo lean para el trabajo normal. Sugiere el modo full solo cuando hagan falta acciones más profundas de búsqueda, recuperación, explicación, riesgo o estadísticas. Sugiere un `sessionId` nuevo y claro cuando cambie el proyecto, repo, cliente, feature o tarea. Sugiere limpieza cuando la memoria esté vieja, ruidosa, mezclada o confusa; primero muestra una vista previa y pide permiso antes de borrar memoria.

Mantén las respuestas breves. Usa tokens en código, pruebas, resultados exactos, bloqueos y próximos pasos.

Los comandos manuales como "usa ShapeLex" o "muéstrame el resumen de memoria de ShapeLex" deben seguir funcionando, pero son una alternativa, no el flujo normal.
