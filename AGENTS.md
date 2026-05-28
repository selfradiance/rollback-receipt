# Coding Agent Instructions

This repo is a narrow local proof. Keep the scope small, deterministic, and testable.

- Do not add network calls to product behavior.
- Do not add AgentGate, MCP, Git, file watcher, background process, directory rollback, glob, patch, or agent execution integration.
- Do not use safety verdict language. This CLI prepares and restores explicit file snapshots only.
- Keep `ROLLBACK_RECEIPT_PROJECT_CONTEXT.md` local and gitignored.
- Update `README.md` and `ROLLBACK_RECEIPT_PROJECT_CONTEXT.md` before a final commit.
- Before claiming done, run:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - `npm run demo:prepare`
  - `npm run demo:restore` or `npm run demo:roundtrip`

