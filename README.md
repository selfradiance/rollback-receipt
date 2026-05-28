# rollback-receipt

`rollback-receipt` is a narrow local TypeScript/Node.js CLI proof for explicit file rollback receipts.

It snapshots files listed in a local plan before an AI coding-agent mutation, writes an inspectable receipt, and can restore only those listed files from the receipt.

This is not backup software. This is not Git. This does not execute or constrain an agent.

## Why It Exists

James Toole's local human-agent supervision work is building small proofs for agent workflow governance. `rollback-receipt` covers the rollback path after coding-agent file mutations: can a local CLI capture the before-state of explicitly listed files and later restore those exact bytes?

## Core Claim

A local deterministic CLI can snapshot explicitly listed project files before an AI coding-agent mutation and produce an inspectable rollback receipt plus a deterministic restore path.

## Quick Start

```bash
npm install
npm test
npm run typecheck
npm run build
```

Prepare a receipt:

```bash
npm run prepare -- --plan examples/mutation-plan.json --snapshot-dir .rollback-receipt/snapshots --receipt-out .rollback-receipt/prepare-receipt.json
```

Restore from the receipt:

```bash
npm run restore -- --receipt .rollback-receipt/prepare-receipt.json
```

## Demo Commands

```bash
npm run demo:prepare
npm run demo:restore
npm run demo:roundtrip
```

`demo:roundtrip` resets the example workspace, prepares a receipt, mutates and deletes the example files, restores them, verifies the original contents, and prints `RESULT: SUCCESS`.

## What The Receipt Proves

The receipt proves that, at prepare time:

- the input plan matched `rollback-receipt.plan.v1`
- every listed path was relative and stayed inside `project_root`
- every listed file existed as a regular file
- symlink paths and symlink target files were rejected
- each listed file was copied into a local snapshot directory
- the source hash and snapshot hash matched
- the receipt lists sorted file entries, SHA-256 hashes, byte sizes, source paths, and snapshot paths

## What Restore Does

Restore validates a `rollback-receipt.receipt.v1` receipt, verifies each snapshot file still exists and matches the recorded SHA-256 hash, then restores the snapshot bytes to the listed target path with a temp-file-then-rename write pattern. It creates missing parent directories inside `project_root` when needed.

Restore does not delete extra files. It only restores explicitly listed regular files from the local snapshot receipt.

## Scope Boundaries

- local CLI only
- TypeScript on Node.js 20+
- Vitest tests
- Zod validation
- no database
- no network calls in product behavior
- no LLM in the critical path
- explicit listed files only

## Explicit Non-Goals

- not backup software
- not Git integration
- no AgentGate integration
- no MCP integration
- no file watcher
- no background process
- no directory rollback
- no glob expansion
- no patch application
- no agent execution
- no broad backup-software claims
- no safety verdict language
- no framework, platform, or SaaS claims

## Relationship To Nearby Repos

- `reapproval-gate`: before-execution escalation gate
- `dependency-drift-gate`: dependency, script, and bin drift visibility
- `agent-intent-ledger`: intent/action drift receipts
- Work Session Ledger: possible future assembler of receipts

`rollback-receipt` is only the local receipt-and-restore proof for explicit regular files.
