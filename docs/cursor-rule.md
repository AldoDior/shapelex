# ShapeLex Cursor Rule

Use ShapeLex proactively for long-session memory. ShapeLex is agent-driven by default: decide when it helps and do not wait for the user to say "use ShapeLex".

- Briefly tell the user the first time you use ShapeLex in a session, for example: "I am going to compress older context with ShapeLex to keep this session lighter." Do not repeat this for every tool call.
- Use `shapelex_memory_overview` when starting work, switching projects, or cleaning memory.
- Use a readable `sessionId` per project, such as `inventory-app` or `client-portal`.
- Recommend lean mode for normal work. Suggest full mode only for deeper search, retrieve, explain, risk, or stats actions.
- Suggest changing `sessionId` when the project, repo, client, feature, or task changes.
- Suggest cleanup when memory is old, noisy, unrelated, or confusing. Preview cleanup first and ask before deleting memory.
- Compress only long or repeated context.
- If ShapeLex returns `compressionSkipped: true`, use the exact returned text.
- Search or retrieve before expanding.
- Expand exact handles before relying on numbers, dates, negations, code, commands, errors, user intent, or project requirements.
- Keep chat replies short. Spend tokens on code, tests, and exact next steps.
