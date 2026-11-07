# Local foundation evidence

Product code: `69c04ee` on `rewrite/integration`.
Date: 2026-11-07. Verification ran with documentation-only edits to this report;
no uncommitted product-code overlay. The final documentation gate was rerun.
This report covers foundations; it does not qualify the rewritten product.

## Executed checks

`npm run verify:v2` exited 0:

- Runner/API/k6 generation checks: 35/21/4 outputs matched their sources.
- TypeScript node/browser checks and ESLint passed.
- Import boundaries, cycles and size checks covered 237 source files.
- Documentation check covered 43 files.
- Frontend production build passed; the main bundle was 602.06 kB / 176.13 kB gzip.
  Vite's large-chunk warning remains; no browser performance claim is made.
- Vitest: 570 tests passed in 47 files, with at most two workers.

Environment: Node v26.7.0 on macOS arm64. Compilation targets Node24, but
compilation alone does not prove Node24 runtime behavior.

Independent read-only reviews cleared the runner and namespace/settings contracts,
HTTP client/kernel, namespace/settings domain, load-plan compiler, agent journal
and JSON operation/error adapters, SQLite metadata and the React namespace shell. Corrections
addressed CREATE idempotency, UUID representation, worker close completion, native
k6 constraints and identical mutation replay after ambiguous server failures.

Real temporary SQLite tests cover journal restart, offer identity, durable cancel,
event ordering/deduplication, quota accounting, replay, monotonic ACK, pruning and
migration rollback. They do not demonstrate container reconciliation or job execution.
Spool quota is a logical byte charge; physical SQLite/WAL size is not qualified.

The JSON operation adapter was exercised through Fastify, including string/buffer/
stream response rejection. The API server factory contains pre-router URL and
parameter errors plus fixed exception mapping. Authentication, scope authorization
and actual application use cases remain unwired.

React tests use the real typed client with synthetic fetch replies. They cover
scope switches/cancellation, bounded pagination, namespace editing and unknown
mutation outcome replay. Visual/mobile browser checks remain unverified.

Real metadata SQLite tests cover scoped identities/FKs, fresh-ID receipt replay,
opposing folder moves, bounded traversal, settings inheritance and runtime
observation expiry/rollback. The worker has queue/deadline/close/crash checks.
This is not HTTP-to-storage integration, backup/restore or Node24 runtime proof.

## Missing release evidence

The complete new submit/execute/observe/finalize/replay path is not implemented.
Files storage, admission, Docker supervision, full k6 runtime, remaining
frontend features, reports/comparison/export and packaging remain incomplete or
under review. The integrated frontend makes real API requests and shows errors;
it does not contain a demo backend or claim a functioning full application.

No new images were built or published; no hosted CI run is claimed. Local Docker
availability was checked read-only: Docker Desktop, Linux arm64. This does not
prove image controls, native amd64 operation or either release installation path.
Node24 runtime, supply-chain/image scans, backup/restore, bounded soak, overhead,
browser visual checks and the native amd64/arm64 matrix remain required.

See [verification](../verification.md) for the full acceptance and failure matrix.
