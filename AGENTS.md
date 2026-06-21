# Agent Instructions

These instructions apply to the entire repository.

## Engineering Posture

Work like a senior/staff software engineer. Optimize for correctness, maintainability, security, and reviewability. Treat every change as if it will be reviewed by a strict staff engineer.

## Understand Before Changing

- Read the relevant files before editing.
- Identify the existing architecture, conventions, naming style, patterns, and dependencies.
- Do not rewrite, reformat, or refactor unrelated code.
- Do not invent requirements. If the request is ambiguous and a wrong assumption would be risky, ask a question before implementing.
- If a task touches risky behavior, explain the risk before proceeding.
- Question whether the requested change is the right change, and point out simpler alternatives when relevant.

## Code Quality

- Prefer simple, explicit, maintainable solutions.
- Avoid clever code unless it is clearly justified by the problem.
- Keep functions small, cohesive, and named for what they do.
- Use meaningful names for variables, functions, classes, tools, and schema fields.
- Follow the existing project style before introducing new patterns.
- Avoid duplication, but do not over-engineer abstractions.
- Preserve backward compatibility unless the task explicitly requires a breaking change.
- Keep public API and MCP tool behavior stable unless changing it is part of the requested work.

## Security

- Never hardcode secrets, credentials, tokens, API keys, passwords, or private URLs.
- Validate inputs at boundaries, especially MCP tool arguments, JSON-RPC params, file paths, handles, and user-provided text.
- Handle errors deliberately. Do not expose sensitive internal details in user-facing or model-facing output.
- Avoid unsafe `eval`, shell injection, SQL injection, path traversal, insecure deserialization, and sensitive-data leakage in logs.
- Use least-privilege assumptions for filesystem, process, network, and external integration behavior.
- If touching auth, payments, permissions, user data, files, process execution, or external integrations, perform an explicit security review before finishing.

## Reliability

- Consider edge cases: null/undefined values, empty arrays, empty strings, malformed JSON-RPC requests, invalid `sx://` URIs, unknown sessions, missing handles, long inputs, and repeated content.
- Consider timeouts, retries, idempotency, concurrency, and partial failures when adding I/O or external integration behavior.
- Do not silently swallow errors.
- Prefer deterministic behavior for compression, anchors, fingerprints, tests, and benchmarks.
- Keep logs useful but not noisy.
- Do not introduce global side effects unless necessary and clearly contained.

## Testing

- Add or update tests for meaningful behavior changes.
- Prefer testing public behavior over implementation details.
- Include success cases, failure cases, and edge cases.
- Run the relevant tests before reporting completion whenever possible.
- If tests cannot be run, say exactly why and what should be run manually.
- Never claim tests passed unless they were actually run.

## Change Discipline

- Make the smallest complete change that solves the problem.
- Before editing, summarize the intended approach.
- After editing, summarize exactly what changed.
- Mention assumptions, risks, and follow-up work.
- Do not perform broad formatting-only changes unless requested.
- Avoid unrelated dependency, metadata, or lockfile churn.

## Review Mindset

- Flag hidden coupling, technical debt, security risks, missing tests, and unclear behavior.
- Be especially cautious around the boundary between compressed memory and exact source text. ShapeLex must not imply that lossy compressed data is exact.
- When adding new MCP tools or resources, document the contract clearly and test the public JSON-RPC behavior.

## Repository Sharing And Open-Source Readiness

- Assume this repository may eventually be shared publicly, open sourced, demonstrated, or handed to other developers.
- Before considering substantial work complete, review whether new or existing files should be excluded from version control.
- Keep `.gitignore` aligned with Node.js, project tooling, generated outputs, local caches, logs, local databases, temporary files, editor files, and machine-specific configuration.
- Identify secrets, credentials, API keys, tokens, certificates, passwords, private URLs, internal endpoints, personal data, local databases, generated artifacts, temporary files, IDE files, build outputs, and logs.
- Never commit secrets or sensitive information.
- Move sensitive values to environment variables or configuration templates when appropriate.
- Create safe example configuration files such as `.env.example` when useful, without exposing real values.
- If sensitive files are already tracked by git, identify them explicitly, explain the risk, and recommend the exact git actions needed to remove them from version control.
- Treat "already committed" and "already pushed" sensitive files as separate security concerns; call out that history rewrite and credential rotation may be required.
- Before finishing substantial work, check whether generated files, caches, dependencies, build artifacts, local databases, temporary files, logs, or editor-specific files are being committed.
- Flag anything that would make the repository difficult for another developer to clone, run, test, or understand.
- Prefer reproducible setup, accurate documentation, secure defaults, minimal machine-specific assumptions, and low onboarding friction.

## Project Conventions Detected

- Runtime: Node.js with ESM modules (`"type": "module"`).
- Source language: TypeScript compiled to `dist/`.
- Minimum Node version: `>=18`.
- Tests: built-in `node:test` with `node:assert/strict`.
- Main source directory: `src/`.
- CLI/bin scripts: `bin/`.
- Tests directory: `test/`.
- Research and architecture notes: `research/`.
- MCP server source: `src/mcp-server.ts`.
- Core engine source: `src/shapelex.ts`.
- Runtime output: `dist/`.
- Package exposes `shapelex-mcp` via `bin/shapelex-mcp.js`.
- Code style: ESM imports, semicolons, two-space indentation, double quotes, explicit helper functions, deterministic pure helpers where practical.

## Project Commands

These commands are confidently detected from `package.json`:

- Start MCP server: `npm start`
- Build TypeScript: `npm run build`
- Run tests: `npm test`
- Run benchmark: `npm run benchmark`

Not configured in `package.json` and needing confirmation before use:

- Lint command: not detected.
- Format command: not detected.

## ShapeLex-Specific Guidance

- Preserve the project thesis: ShapeLex is a navigable compressed memory layer, not a magical reconstruction system.
- Preserve exact expansion through `sx://` handles when exact wording matters.
- Risk assessment is part of correctness. When compressed output may omit important semantics, expose `shouldExpand` or `mustExpand` rather than pretending the summary is enough.
- Protect negations, numbers, dates, operators, code signals, decisions, user constraints, and explicit instructions.
- Do not treat code as plain text when the task is about repository understanding; preserve imports, symbols, references, dependencies, errors, and stack traces where relevant.
- Keep local persistence private by default: `.shapelex/` is ignored and should not be committed.
- Do not introduce databases, external LLM calls, embedding APIs, or network dependencies unless explicitly requested.
- Keep benchmark changes reproducible and deterministic.
