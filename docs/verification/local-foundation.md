# Local foundation evidence

Full-gate source: `1538ae8` on `rewrite/integration`.
Date: 2026-11-07. Verification ran with a clean worktree at this source;
subsequent edits to PLAN and this report are documentation only.
This report covers foundations; it does not qualify the rewritten product.

## Executed checks

`npm run verify:v2` exited 0:

- Runner/API/k6 generation checks: 35/21/6 outputs matched their sources.
- TypeScript node/browser/native-k6 checks and ESLint passed.
- Import boundaries, cycles and size checks covered 353 source files.
- Documentation check covered 54 files.
- Frontend production build passed; the main bundle was 602.06 kB / 176.13 kB gzip.
  Vite's large-chunk warning remains; no browser performance claim is made.
- Vitest: 987 tests passed in 78 files, with at most two workers.

Environment: Node v26.7.0 on macOS arm64. Compilation targets Node24, but
compilation alone does not prove Node24 runtime behavior.

Independent read-only reviews cleared the runner and namespace/settings contracts,
HTTP client/kernel, namespace/settings domain, suite compiler/native runtime,
agent journal/admission, Docker adapter, namespace HTTP routes and JSON operation/error
adapters, SQLite metadata and the React namespace shell. Corrections
addressed CREATE idempotency, UUID representation, worker close completion, native
k6 constraints and identical mutation replay after ambiguous server failures.

Real temporary SQLite tests cover journal restart, offer identity, durable cancel,
event ordering/deduplication, quota accounting, replay, monotonic ACK, pruning and
migration rollback. Admission tests cover global reservations, cancellation races,
single-dispatch claims, launch settlement and strictly later release evidence.
Those records store trusted assertions; they do not prove a real supervisor's
quiescence or runtime/resource enforcement.
Spool quota is a logical byte charge; physical SQLite/WAL size is not qualified.

The private supervision-clock amendment covers first cancellation time,
sticky rollback, scoped generation, queue retirement and transaction/migration
rollback. Independent review found a mismatch with previously accepted admission
clocks beyond Date's range. Corrective source `535ff6b` preserves that exact numeric
high-water, fences timing and still commits cancellation. Its 15 focused tests and
independent re-review pass. The full gate above predates that storage-bound correction;
no full-suite result at the corrective source is claimed here. Migration004 is an
unpublished rewrite draft, not an upgrade of a released v4 journal database.

The JSON operation adapter was exercised through Fastify, including string/buffer/
stream response rejection. The API server factory contains pre-router URL and
parameter errors plus fixed exception mapping. Namespace create/read/update/list
routes exercise actual SQLite use cases, scope checks and receipt replay. Tests
inject a synthetic guard; actual sessions, Host/Origin and CSRF remain unwired.

React tests use the real typed client with synthetic fetch replies. They cover
scope switches/cancellation, bounded pagination, namespace editing and unknown
mutation outcome replay. Visual/mobile browser checks remain unverified.

Real metadata SQLite tests cover scoped identities/FKs, fresh-ID receipt replay,
opposing folder moves, bounded traversal, settings inheritance and runtime
observation expiry/rollback. The worker has queue/deadline/close/crash checks.
This is not backup/restore or Node24 runtime proof.

Docker adapter tests are synthetic (124 cases): bounded Unix transport, ownership
and effective-control inspection, one-start fences, cancellation grace rounding,
stale absence and late-response races. No container was launched for this evidence.
Staging ownership/host-path mapping and actual Linux controls remain unqualified.

The shared compiler/runtime/builder has 250 integrated tests. Separate author
evidence at runtime source `51e21b9` records stock k6 v2.2.0 on Darwin arm64:
actual bundle inspect exited 0; no-network injected-adapter execution exited 0
for pass and 99 for required-assertion failure without a user SLO. Corrective
source `2b41a66` passed independent in-memory depth/global-VU probes; native fixtures
were not rerun for that correction. These are not HTTP-target or Linux evidence.
Retained native response bodies buffer before JS caps; see [exception E02](../engineering-exceptions.md).

## Missing release evidence

The complete new submit/execute/observe/finalize/replay path is not implemented.
Files storage, actual Docker supervision/wrapper, sample aggregation, remaining
frontend features, reports/comparison/export and packaging remain incomplete or
under review. The integrated frontend makes real API requests and shows errors;
it does not contain a demo backend or claim a functioning full application.

No new images were built or published; no hosted CI run is claimed. Local Docker
availability was checked read-only: Desktop 4.98.0, Engine 29.9.2, Linux arm64. This does not
prove image controls, native amd64 operation or either release installation path.
Node24 runtime, supply-chain/image scans, backup/restore, bounded soak, overhead,
browser visual checks and the native amd64/arm64 matrix remain required.

See [verification](../verification.md) for the full acceptance and failure matrix.
