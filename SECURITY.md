# Security Policy

## Supported Versions

ShapeLex is early software. Security fixes are applied to the latest published version.

## Reporting A Vulnerability

Open a private security advisory on GitHub if the repository is public. If private advisories are not enabled yet, contact the maintainer directly and avoid posting exploit details in a public issue.

## Security Model

ShapeLex is a local MCP server. It does not call external LLMs, embedding APIs, databases, or network services. It stores exact source text locally so agents can recover exact wording through `sx://` handles.

The local store can contain sensitive data. Treat `.shapelex/` as private user data and never commit, publish, or upload it.

## Supply-Chain Posture

- Runtime dependencies are intentionally zero.
- Development dependencies are limited to TypeScript and Node.js type definitions.
- The package does not use install-time lifecycle scripts.
- `prepack` builds artifacts for npm packaging, but consumers do not need to run build scripts during install.
- Published package contents are constrained with the `files` allowlist in `package.json`.

## User Responsibilities

- Keep Node.js updated.
- Review `npm pack --dry-run` output before publishing.
- Do not publish `.shapelex/`, `.npm-cache/`, `node_modules/`, logs, private research notes, or local configuration.
- Rotate any credential that was accidentally compressed into the local store and may have been shared.
