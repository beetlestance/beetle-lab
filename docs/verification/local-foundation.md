# Local foundation evidence

Full-gate source: `db639d7` on `rewrite/integration`.
Date: 2026-11-07. Verification ran with a clean worktree at this source;
later integrated settings UI/staging have the separate scoped evidence below.
This report covers foundations; it does not qualify the rewritten product.

## Executed checks

`npm run verify:v2` exited 0:

- Runner/API/k6 generation checks: 37/21/6 outputs matched their sources.
- TypeScript node/browser/native-k6 checks and ESLint passed.
- Import boundaries, cycles and size checks covered 394 source files.
- Documentation check covered 59 files.
- Frontend production build passed; the main bundle was 602.06 kB / 176.13 kB gzip.
  Vite's large-chunk warning remains; no browser performance claim is made.
- Vitest: 1,159 tests passed in 97 files, with at most two workers.

Environment: Node v26.7.0 on macOS arm64. Compilation targets Node24, but
compilation alone does not prove Node24 runtime behavior.

Independent read-only reviews cleared the runner and namespace/settings contracts,
HTTP client/kernel, namespace/settings domain, suite compiler/native runtime,
agent journal/admission/supervisor, Docker/staging adapters, namespace/settings HTTP
routes and JSON operation/error adapters, SQLite metadata, React namespace/settings
screens and wrapper control journal. Corrections
addressed CREATE idempotency, UUID representation, worker close completion, native
k6 constraints and identical mutation replay after ambiguous server failures.

Real temporary SQLite tests cover journal restart, offer identity, durable cancel,
event ordering/deduplication, quota accounting, replay, monotonic ACK, pruning and
migration rollback. Admission tests cover global reservations, cancellation races,
single-dispatch claims, launch settlement and strictly later release evidence.
Those records store trusted assertions; they do not prove runtime/resource enforcement.
Spool quota is a logical byte charge; physical SQLite/WAL size is not qualified.

The private supervision-clock amendment covers first cancellation time,
sticky rollback, scoped generation, queue retirement and transaction/migration
rollback. Independent review found a mismatch with previously accepted admission
clocks beyond Date's range. Corrective source `535ff6b` preserves that exact numeric
high-water, fences timing and still commits cancellation. Its 15 focused tests and
independent re-review pass and are included in the full gate. Migration004 is an
unpublished rewrite draft, not an upgrade of a released v4 journal database.

The actual launch supervisor has 81 integrated synthetic/SQLite tests. Reviewed
corrections retain actual evidence before settlement, use atomic final clock grants,
and permit stop/kill after durable cancellation despite persistent event-spool failure.
Recovery never redispatches a consumed claim or upgrades uncertain start from an exit
sample. No real containers, wrapper guard capability or collection/release is proven.

Private staging accounting pins exact offer/input bytes, bounded metadata and secret
allowances before setup. Its 11 tests include overflow and exact physical free-space
boundaries. StagedAttempt schema tests establish structure, not cross-file authenticity.

The JSON operation adapter was exercised through Fastify, including string/buffer/
stream response rejection. The API server factory contains pre-router URL and
parameter errors plus fixed exception mapping. Namespace create/read/update/list
and six settings GET/PATCH routes exercise actual SQLite use cases and scope checks.
Identity-only settings lookup permits receipt replay after capacity expires. Tests
inject a synthetic guard; actual sessions, Host/Origin and CSRF remain unwired.

React tests use the real typed client with synthetic fetch replies. They cover
scope switches/cancellation, bounded pagination, namespace editing and unknown
mutation outcome replay. Later settings UI source `eb8b27d` passed 66 integrated
frontend tests and all typechecks, separately from the full gate above. Review
covered scoped overrides/null inheritance, integer/retention forms, parent
invalidation, late replies, exact replay and conflicts. Its author build passed
(main 603.74 kB warning retained). Visual/mobile browser checks remain unverified.

Real metadata SQLite tests cover scoped identities/FKs, fresh-ID receipt replay,
opposing folder moves, bounded traversal, settings inheritance and runtime
observation expiry/rollback. The worker has queue/deadline/close/crash checks.
This is not backup/restore or Node24 runtime proof.

Docker adapter tests are synthetic (124 cases): bounded Unix transport, ownership
and effective-control inspection, one-start fences, cancellation grace rounding,
stale absence and late-response races. No container was launched for this evidence.
Staging ownership/host-path mapping and actual Linux controls remain unqualified.

Later file-staging source `4dc4405` passed 70 integrated tests and all typechecks,
separately from the full gate above. Independent review cleared the original-close
quiescence correction. Actual temp files/SQLite plus synthetic daemon replies cover
charged authority before writes, size/hash/mode checks, restricted secrets, two active
slots and late I/O. Failed close retains unknown quiescence. This is not proof of
Docker/Desktop mount visibility. A known secret-name grammar mismatch between runner
and k6 contracts remains to fix before the real input-loader path.

The wrapper control journal has 55 integrated filesystem/fault tests. Independent
probes verified poison-before-reentry, close-before-notification handoff and both
descriptor cleanups on initialization failure. Exclusive creation and read-only
replay do not establish power-loss or platform durability qualification.

The shared compiler/runtime/builder has 250 integrated tests. Separate author
evidence at runtime source `51e21b9` records stock k6 v2.2.0 on Darwin arm64:
actual bundle inspect exited 0; no-network injected-adapter execution exited 0
for pass and 99 for required-assertion failure without a user SLO. Corrective
source `2b41a66` passed independent in-memory depth/global-VU probes; native fixtures
were not rerun for that correction. These are not HTTP-target or Linux evidence.
Retained native response bodies buffer before JS caps; see [exception E02](../engineering-exceptions.md).

## Missing release evidence

The complete new submit/execute/observe/finalize/replay path is not implemented.
Application artifact storage, wrapper/native child coordination, aggregation, remaining
frontend features, reports/comparison/export and packaging remain incomplete or
under review. The integrated frontend makes real API requests and shows errors;
it does not contain a demo backend or claim a functioning full application.

No new images were built or published; no hosted CI run is claimed. Local Docker
availability was checked read-only: Desktop 4.98.0, Engine 29.9.2, Linux arm64. This does not
prove image controls, native amd64 operation or either release installation path.
Node24 runtime, supply-chain/image scans, backup/restore, bounded soak, overhead,
browser visual checks and the native amd64/arm64 matrix remain required.

See [verification](../verification.md) for the full acceptance and failure matrix.
