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

## UI sequencing

Complete the current functional plan first. The current UI is provisional; its
layouts and workflows are not the accepted final experience. After functionality
is concrete, perform a separate UI audit and plan a full redesign, rather than a
polish pass. Current UI work is limited to exposing required functions and fixing
blocking correctness/accessibility/safety issues. See the
[sequencing decision](docs/decisions/012-ui-redesign-after-functional-rewrite.md).

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

These are locally verified source capabilities. They do not establish hosted CI,
final images or a qualified R0-R4 release. The [documentation map](docs/README.md)
links evidence; the [parity checklist](docs/verification/functional-parity.md)
links the complete source/evidence inventory audit; final acceptance is still open.

| Area | Locally integrated | Evidence |
| --- | --- | --- |
| History controls/scalars | Scoped filters/keyset order, verified metrics/storage provenance and bounded indexed current-name/ID-prefix search | [H1](docs/verification/run-history-query.md), [H2](docs/verification/run-history-summary.md), [H3](docs/verification/run-history-search.md) |
| Execution | Durable intake/admission/delivery/cancel, scheduling, real arm64 k6 pass/fail and metadata reopen | [Native application](docs/verification/native-application-k6.md) |
| Result custody | Source/absence closure, event replay, artifact publication and verified downloads | [Source-free path](docs/verification/output-absence.md), [downloads](docs/verification/run-artifact-downloads.md) |
| Metrics | Live windows, sealed history/charts, duration estimates, resources and target observations | [Live path](docs/verification/native-live-metrics.md), [history](docs/verification/run-metric-history.md), [target views](docs/verification/target-observation-contract.md) |
| Product | Namespace list/create/rename, settings, authoring, inputs, submit/history/detail/cancel, comparison and reports | [First use](docs/verification/first-use.md) |
| Export | Durable jobs, API/UI/download and actual offline Docker/restart | [Public exports](docs/verification/public-standalone-export.md) |
| Overview | Exact workspace counts, hourly submissions and bounded recent/active links | [Overview](docs/verification/workspace-overview.md) |
| Load advice | Observed dropped iterations and explicit iteration-median VU heuristic | [Guidance](docs/verification/load-advice.md) |
| Navigation/reference | Command search, API/config downloads and standalone agent instructions | [Search](docs/verification/command-search.md), [reference](docs/verification/embedded-reference.md) |
| Cleanup/retention | Reserved ACK, automatic driver, native recovery, exact-once settlement/replay floors, protected preview/Apply/progress | [Cleanup index](docs/verification/output-retirement-progress.md), [retention recovery](docs/verification/native-retention.md) |

[Operation availability](docs/verification/reference-availability.md) records the
current63 JSON descriptors:63 implemented, including empty-only namespace deletion and organisation overview.
Registration does not prove runtime readiness or complete feature acceptance.
Native live activation uses [trusted image capability](docs/decisions/014-live-metric-approval-authority.md).

## Remaining before complete R0-R4 acceptance

| Work | Required completion |
| --- | --- |
| Namespace deletion | Empty-only deletion locally implemented; nonempty recursive maintenance unsupported; packaged acceptance remains |
| Input/config parity | Directory-tree upload and immutable replacement acceptance remain; selected-revision summary/exact-suite history are locally implemented |
| Diagnostics/warnings | Bounded retained/replayed diagnostics, native warning classification and configured-scenario advice |
| Overview | Workspace and whole-organisation rollups locally implemented; packaged/platform acceptance remains |
| Recovery | Remaining delivery restart/cold-restore proof and supported cold backup/restore tooling |
| Acceptance | Every F/N inventory ID and V failure case needs source-bound acceptance; resolve recorded failures |
| Qualification | Final source/pull installs, matching images/CI, browser/automation, native amd64/arm64, scans, soak, overhead and rollback |

The [inventory audit](docs/verification/inventory-audit.md) covers all36 F/N IDs
without promoting component evidence to release acceptance. The ordered
[remaining backlog](docs/execution/remaining-rewrite.md) owns concrete exit conditions.
Cleanup/settlement/protected retention are locally complete; their platform/image
limits remain release work. Input/revision pins are preserved; no Run-pin UI is
claimed. Parent retention is live/partial, with explicit workspace Apply.
Functional closure remains separate from the deferred UI redesign.

## Local first-use corrections

- [Ordinary source Compose](docs/verification/compose-first-boot.md) now provisions
  empty state, automatic access and both engines without the custom launcher.
  Actual arm64 first boot, k6/export, second up and restart are locally verified;
  published pull-install and the release matrix remain pending.
- [Automatic local access](docs/verification/local-auto-session.md) is implemented:
  loopback browser sessions need no token, persist for their remaining8h lifetime
  across restart, and retain exact origin/CSRF checks. The paired profile is explicit;
  final packaged-browser qualification remains pending.

Large input bodies and the initial optional target collector are now locally verified;
see [feature evidence](docs/verification/large-bodies-target-observations.md).
Target observation views are locally implemented; packaged browser/native and
release qualification remain pending.

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
