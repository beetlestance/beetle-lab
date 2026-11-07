# Local foundation evidence

Source: `e548a8f02fa1d5e4f8db9b8f51f50f25acd21cad` on `rewrite/integration`.
Date: 2026-11-07. Working tree was clean for the recorded verification.
This report covers foundations; it does not qualify the rewritten product.

## Executed checks

`npm run verify:v2` exited 0:

- Runner/API/k6 generation checks: 35/21/4 outputs matched their sources.
- TypeScript node/browser checks and ESLint passed.
- Import boundaries, cycles and size checks covered 198 source files.
- Documentation check covered 38 files.
- Vitest: 476 tests passed in 36 files, with at most two workers.

Environment: Node v26.7.0 on macOS arm64. Compilation targets Node24, but
compilation alone does not prove Node24 runtime behavior.

Independent read-only reviews cleared the runner and namespace/settings contracts,
HTTP client/kernel, namespace/settings domain, load-plan compiler, agent journal
and JSON operation registration adapter. Corrections addressed CREATE idempotency,
UUID representation, worker close completion and native k6 constraints.

Real temporary SQLite tests cover journal restart, offer identity, durable cancel,
event ordering/deduplication, quota accounting, replay, monotonic ACK, pruning and
migration rollback. They do not demonstrate container reconciliation or job execution.
Spool quota is a logical byte charge; physical SQLite/WAL size is not qualified.

The JSON operation adapter was exercised through Fastify, including string/buffer/
stream response rejection. It does not supply authentication, scope authorization,
safe global exception mapping or actual application use cases.

## Missing release evidence

The complete new submit/execute/observe/finalize/replay path is not implemented.
Metadata/files storage, admission, Docker supervision, full k6 runtime, frontend,
reports/comparison/export and packaging remain incomplete or under review.

No new images were built or published; no hosted CI run is claimed. Local Docker
availability was checked read-only: Docker Desktop, Linux arm64. This does not
prove image controls, native amd64 operation or either release installation path.
Node24 runtime, supply-chain/image scans, backup/restore, bounded soak, overhead,
browser visual checks and the native amd64/arm64 matrix remain required.

See [verification](../verification.md) for the full acceptance and failure matrix.
