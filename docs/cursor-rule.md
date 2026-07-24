# ShapeLex Cursor Rule

Use ShapeLex for long-session memory.

- Use `shapelex_memory_overview` when starting work, switching projects, or cleaning memory.
- Use a readable `sessionId` per project, such as `dad-inventory-app` or `client-portal-fix`.
- Compress only long or repeated context.
- If ShapeLex returns `compressionSkipped: true`, use the exact returned text.
- Search or retrieve before expanding.
- Expand exact handles before relying on numbers, dates, negations, code, commands, errors, user intent, or project requirements.
- Keep chat replies short. Spend tokens on code, tests, and exact next steps.
