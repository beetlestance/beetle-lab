# beetle-lab full rewrite

Status: implementation in progress; the released application is preserved.
Branch: `rewrite/integration`
Local evidence: [foundation verification](docs/verification/local-foundation.md).

## Direction

Build a new TypeScript application and execution agent with fresh storage and
versioned contracts. Reimplement the product capabilities in the
[current feature inventory](docs/current-features.md); do not wrap the old
server or carry its internal structure forward.

The user confirmed that no legacy configs/history remain to migrate. No old HTTP
routes, storage keys, config parser, history reader, import tool or rollback window
is required. Qualify a fresh installation. Preserve existing source until rewrite
acceptance; ordinary rollback applies only to future v2 image/schema versions.

## Read in this order

1. [Feature inventory](docs/current-features.md): implemented scope and deliberate changes.
2. [HLD](docs/design/HLD.md): components, ownership, deployment and tradeoffs.
3. [LLD index](docs/design/LLD.md): contracts split by implementation responsibility.
4. [Engineering rules](docs/engineering.md): small modules and enforceable boundaries.
5. [Verification](docs/verification.md): acceptance evidence and failure scenarios.

The [documentation map](docs/README.md) identifies the minimum reading for each task.
[Execution plan](docs/execution/README.md) owns effort ranges, the dependency graph,
model assignments, agent packets, concurrency and independent review.

## Current implementation

| Area | Integrated | Still required |
| --- | --- | --- |
| Foundation/contracts | Workspace gates; strict runner/staged-input, namespace/settings, suite and run-intake schemas/clients; exact installed descriptor binding in immutable Offers; atomic queued-run/attempt/outbox SQLite intake; authenticated enqueue/detail/history routes; Fastify JSON adapter; separate config/Offer bounds; private agent/backend capacity publication and owned startup/shutdown; shared exact staging accounting and same-lease execution limits; bounded claim/observation transactions, metadata dispatch RPC and immutable journal binding; bounded automatic delivery/reconciliation; receipt-first scoped cancellation; durable event ingestion/ACK and fair collection | Result routes and result storage |
| Agent | Catalogue/admission/staging/controllers; typed stops; bounded scheduling; guards/full observation publisher; installed runtime; Node24 image/private HTTP; real arm64 k6 pass/fail; journal010/immutable identity and atomic fresh cancellation refusal; exclusive control store and actual startup/wire binding; large-original bounds, propagation and launch contention; admission carrier at node/depth maxima; immutable collected output root/byte facts | First-install provisioning; updated image/Compose/stop-latency qualification, irreversible recovery fencing, telemetry, application artifact transfer/finalization and native architecture matrix |
| k6 | Suite compiler/runtime/builder, phase-isolated metrics, control journal, staged loader, child runner, numeric windows, summary collector, outcome mapper, staged wrapper, seal codec and artifact publication | Live quantiles, target sampler, reports/export |
| Product | Namespace/settings and immutable suite/revision SQLite/API composition; native input publication/HTTP/recovery, bounded byte client and scoped inventory/deletion UI; sessions, paired React authoring, session-owned upload/download controls and dev proxy; scoped run history/detail and saved-revision submission/replay and scoped cancellation controls | Browser qualification, live metrics, artifact store, reports, automation client and Docker frontend proxy |
| Qualification | Local contract/unit/SQLite and real staged native pass/fail checks | Complete execution path, containers, scans, backup/soak and native architecture matrix |

Worker submissions require independent review and exact-source integration checks.
The [run-controls report](docs/verification/run-controls.md) records the reviewed
UI/admission carrier, full local verification and browser/execution limits.
The [dispatch report](docs/verification/dispatch-rpc.md) records the earlier storage
and worker RPC boundary. Backend delivery, cancellation and durable event transport are connected; artifact/result handling remains
pending; [delivery authority](docs/design/lld/delivery-authority.md) defines the
accepted restart/cold-restore contract still requiring implementation. Earlier
component reports are indexed in the [documentation map](docs/README.md).

[Automatic delivery evidence](docs/verification/delivery-runtime.md) records the
connected private HTTP/SQLite recovery path, synthetic-peer limits and full local gate.
[Durable cancellation evidence](docs/verification/cancellation.md) records scoped intent,
atomic original refusal, review corrections and the full local gate.
[Event custody evidence](docs/verification/event-custody.md) records the reviewed
backend transport path. [Actual agent event recovery](docs/verification/event-agent.md)
adds separate-process HTTP/Journal pruning/reopen evidence; artifact/result qualification remains.
No complete R0-R4 release slice is claimed. Native engine component evidence does
not establish the new backend path, Compose install or supported architecture matrix.
[Disk retention evidence](docs/verification/disk-retention.md) records integrated
atomic output/staging holds through execution release and391 focused passing tests;
cleanup and complete result transfer/finalization remain pending.
[Source values evidence](docs/verification/output-source-values.md) records reviewed
private codecs, digest vectors and native stopped-root facts.
[Source Journal evidence](docs/verification/output-source-journal.md) records
implemented durable intents/sources, exact quota and receipt-gated release.
[Controller source evidence](docs/verification/controller-source-lifecycle.md) records
integrated native collection, stable source requests and conservative restart recovery.
Source-backed stream closure storage and indexed debt discovery are implemented;
[closure evidence](docs/verification/output-delivery-closure.md) records scoped limits.
Manager producer barriers, scheduler wiring, artifact transfer and publication are next.
The [result panel](docs/verification/run-result-panel.md) is implemented with explicit
unavailable data until the backend result read path exists.

## Delivery order

| Slice | Deliverable | Exit condition |
| --- | --- | --- |
| R0: foundation | Workspace, schemas, dependency rules, bounded telemetry primitives | Type/schema/import/size checks and contract negatives pass |
| R1: execution kernel | Agent journal, capacity admission, container backend, fake engine | Oversubscription, OOM, cancellation and restart fixtures pass |
| R2: complete k6 path | Engine wrapper, scenarios, assertions, datasets, target sampler | Submit -> execute -> observe -> finalize -> replay works without the old app |
| R3: product surface | Organisation/workspace/folders, settings, API, automation client, live charts, comparison, reports, export | Every release-blocking inventory item has an acceptance fixture |
| R4: release qualification | Package images, docs, bounded soak, scans, OS matrix | Verification matrix is evidenced; fresh Docker install and supported v2 rollback pass |
| R5: additional engines | Playwright, then language-specific mutation adapters | Each engine passes the same conformance suite and its own result tests |
| R6: authoring expansion | Case editor and generation into reviewable source | Generation has explicit inputs, preview, resource budget and run authorization |
| R7: optional shared profile | PostgreSQL and S3/RustFS, remote agents and authorization | Separate design addendum and distributed-failure qualification approved |

R0-R4 replace the current product. R5-R7 are follow-on scope, not prerequisites
for releasing a useful k6 rewrite. R2 includes a container-run automation harness; R3 completes
the HTTP/report interface. No host-installed CLI is required. Deliver vertical slices rather than building
all abstraction layers before the first execution works.

## Decisions and proposals

Agreed: full rewrite, TypeScript control layer, execution isolation, pluggable
engines, SQLite/files locally, optional PostgreSQL/S3 later, bounded components
and useful CPU/memory/job observability from the start. Docker/Compose distribution
targets linux/amd64 and linux/arm64, with separate frontend/backend/agent containers.
Organisation -> workspace -> optional nested folders scopes suites and inputs.
Validated UI settings own run defaults and retention; installation limits remain enforced.
[MIT licensing](docs/decisions/002-mit-license.md) is settled, with optional README credit.

Confirmed deployment: separate frontend/backend/agent images, Docker/Compose
distribution, amd64/arm64, no legacy migration. Fastify replaces Express for both
backend and private agent HTTP adapters. JSON Schema contracts and SSE reads remain
proposed protocol choices. Frontend selection is delegated: choose React/Vite,
React Router and TanStack Query with accessible motion/reduced-motion behavior.
Asset terms remain in the
[detailed frontend discussion](docs/design/frontend-decisions.md).

Release scope is confirmed: current k6 capabilities plus organisations/settings
first; additional engines later. Each local installation has one administrator;
organisation namespaces do not introduce member roles. Hosted IAM is deferred.
Parallel execution follows user request, configured limits and available capacity.
Optional idle/thermal conditions must identify what the runtime can measure.
Measure stack overhead and let users allocate execution/storage budgets; do not
impose an arbitrary minimum machine or fixed storage allocation. Authoring uses
form and JSON editors; secrets come from environment/mounted files; explicit tool
steps replace raw shell hooks; ship a reference engine template without an SDK.
Use neutral independently authored UI assets until asset terms are settled. Before R4, qualify
architectures and report actual overhead plus enforced controls. Agentless/native-process execution, cron, arbitrary workflow DAGs and a
plugin marketplace are outside R0-R4. The user's second new feature is deferred
until after the rewrite; no scope is inferred for it.

## Change discipline

Each implementation task names one owner, contract, budget, failure tests and
acceptance result. Update the owning specification when behavior changes. Record
a settled decision in a small decision file; do not append transcripts or
implementation journals to this plan. Mark planned/local/CI/release evidence
accurately. See [the rewrite decision](docs/decisions/001-clean-rewrite.md).

Implementation is authorized on the separate rewrite integration branch. Preserve
the existing application until the new path qualifies. Push, protection changes,
publication and deployment require separate explicit authorization.
