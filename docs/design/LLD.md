# Low-level design map

Status: v2 design with partially implemented contracts and components; [PLAN](../../PLAN.md) records current coverage.
The owning document below must be updated before its implementation changes.

| Implementing | Read | Includes |
| --- | --- | --- |
| Organisation and settings | [Organisation/settings](lld/organization-settings.md) | Hierarchy, scoped access, folders, inheritance and safe settings changes |
| Source/build layout | [Module map](lld/module-map.md) | Package tree, named owners, import graph and build boundaries |
| Domain and storage | [Domain/storage](lld/domain-storage.md) | State, tables, transaction ownership, artifacts, secrets |
| Durable dispatch/storage | [Dispatch storage](lld/dispatch-storage.md), [output allocation](lld/output-allocation.md) | Claim/ACK/recovery, bounded isolation and shared byte reservations |
| Durable cancellation | [Cancellation](lld/cancellation.md) | Scoped public intent, atomic original refusal, delivery races and UI confirmation |
| Durable event transport | [Event custody](lld/event-custody.md) | Bounded batch/cursor commit before ACK, replay, gaps, output accounting and shutdown |
| Published artifact downloads | [Run artifacts](lld/run-artifact-downloads.md) | Scoped immutable publication metadata and bounded native HTTP content |
| Execution activity UI | [Run timeline](lld/run-timeline-ui.md) | Bounded recent activity, polling/lifetime and truthful progress/resource display |
| Public durable event reads | [Run events](lld/run-event-reads.md) | Scoped finite cursor pages, storage bounds and client ownership |
| Backend snapshot merge | [Attempt observation](lld/attempt-observation.md) | Identity, sequence/independent fact merge and nonterminal run projection |
| Agent admission evidence | [Admission evidence](lld/agent-admission-evidence.md) | Independent queue refusal/released-reservation facts, merge rules and release authority |
| Suite authoring | [Suites/revisions](lld/suite-authoring.md) | Scoped authoring, immutable revisions, large bounded configs and editor behavior |
| Input bytes | [Input publication](lld/input-publication.md) | Durable upload/offset/publication custody, quotas, pins and scoped binary transport |
| Input routes | [Input HTTP](lld/input-http.md) | Pre-body guards, chunk/range transfer, request originals and shutdown |
| Browser input bytes | [Input client](lld/input-client.md) | Bounded file preparation, append acknowledgement, download EOF/hash and original custody |
| Input controls | [Input UI](lld/input-ui.md) | Prepared upload intent/replay, folder selection, verified download and session ownership |
| Backend capacity publication | [Capacity polling](lld/runtime-polling.md) | One original iteration, unknown coalescing, SQLite refusal and shutdown custody |
| Backend runner connection | [Backend connection](lld/backend-connection.md) | Private configuration, original HTTP custody and independently measured backend storage |
| Application run enqueue | [Run intake](lld/run-intake.md) | Receipt-first enqueue, pinned execution/settings and bounded run reads |
| Dispatcher, agent or engine | [Execution protocol](lld/execution-protocol.md) | APIs, envelopes, idempotency, fencing, cancellation, recovery |
| Installed execution binding | [Installed identity](lld/installed-identity.md) | Canonical content pins, required Offer binding and replay/recovery authority |
| Full-size runner intake | [Offer envelopes](lld/runner-envelopes.md) | Independent config/envelope bounds, ingress ownership and journal migration008 |
| Launch read saturation | [Launch contention](lld/launch-contention.md) | Retained explicit intent, known refusal, compact authority and unknown-outcome fences |
| Collected output facts | [Collection custody](lld/output-collection-custody.md) | Private bounded root/result facts after original closes; not source/publication authority |
| Agent disk retention | [Disk retention](lld/disk-retention.md) | Required active/retained disk accounting contract, journal quota and atomic migration policy |
| Verified source decisions | [Verified output source](lld/output-source.md) | Settled custody decisions and focused contract ownership |
| Source commit contract | [Durable collected source](lld/output-source-commit.md) | Reviewed local values/Journal/controller components; backend publication pending |
| Shared source values | [Public manifests](lld/output-public-values.md) | Shared pure manifest prepare/verify and private agent delegation; no custody authority |
| Source collection recovery | [Collection intent](lld/output-collection-intent.md) | Implemented preparation gate and conservative absent-source recovery |
| Source Journal contract | [Source transactions](lld/output-source-journal.md) | Implemented/reviewed local storage and controller components |
| Output transport direction | [Output transfer](lld/output-transfer.md) | Integrated source wire/service/HTTP; backend adoption pending |
| Source event-stream end | [Delivery closure](lld/output-delivery-closure.md) | Integrated Journal013, producer drain and indexed discovery |
| Backend payload storage | [Payload carrier](lld/output-payload.md) | Integrated single result/manifest body, snapshot replay and shared event allowance |
| Native output ownership | [Output files](lld/output-files.md) | Integrated native byte adapter and ownership; transfer composition pending |
| Source adoption storage | [Adoption store](lld/output-adoption-store.md) | Integrated metadata adoption/RPC, original pins, event ceiling and upload tokens |
| Source-backed terminal settlement | [Output finalization](lld/output-finalization.md) | Integrated bounded metadata finalization; release qualification pending |
| Source-free terminal settlement | [Output absence](lld/output-absence.md) | Integrated definitive retirement, snapshot reconciliation and sibling accounting |
| Automatic backend output owner | [Output runtime](lld/output-runtime.md) | Integrated bounded scheduling, startup and parent wiring |
| Backend output direction | [Output adoption](lld/output-adoption.md) | Reviewed shared-budget direction; exact storage/finalization contracts pending |
| Agent control and outputs | [Agent collection](lld/agent-collection.md) | Bounded file intake, atomic checkpoints, stopped verification and artifact custody |
| Attempt orchestration | [Agent controller](lld/agent-controller.md) | Prepared-plan handoff, supervision/control/collection wiring and release ownership |
| Installed engine preflight | [Engine catalogue](lld/engine-catalog.md) | Trusted schema bundles, manifest/profile pins and recovery identity |
| Installation execution | [Installation controller](lld/installation-controller.md) | Queue/admit/stage/drive ownership, cancellation and restart |
| Installation scheduling | [Agent scheduler](lld/agent-scheduler.md) | Indexed active discovery, bounded original calls and shutdown ownership |
| Attempt stop reasons | [Agent stop](lld/agent-stop.md) | First durable cause, restart, system stop versus user cancellation |
| Live output guard | [Output guard](lld/output-guard.md) | Bounded metadata scans, freshness watchdog, watch and stop ownership |
| Independent execution timeout | [Timeout guard](lld/timeout-guard.md) | Durable admission deadline, independent polling, clock fences and original-stop ownership |
| Full resource/guard publication | [Observation publisher](lld/observation-publisher.md) | Freshness composition, held-I/O revocation and original-write ownership |
| Agent capacity wire/receiver | [Capacity observation](lld/capacity-wire.md) | Committed source age, global/per-run ceilings, provenance and backend cache fences |
| Installed agent startup | [Agent runtime](lld/agent-runtime.md) | Actual component wiring, initial readiness and independent shutdown drains |
| Fresh offline installation | [Provisioning](lld/fresh-installation.md) | Private configuration, inspected image pins, explicit Journal authority and replay |
| Mounted input/secret intake | [Installed providers](lld/installed-providers.md) | Scoped lazy input streams, explicit aliases, bounded private files and original cleanup |
| Agent executable/container | [Executable agent](lld/executable-agent.md) | Private configuration, shipped schema bindings, signal ownership and image boundary |
| Private runner HTTP | [Agent HTTP](lld/agent-http.md) | Credential/scope fences, bounded runner DTOs and request ownership |
| Public event replay and activity | [Event reads](lld/run-event-reads.md), [activity UI](lld/run-timeline-ui.md) | Scoped bounded durable reads and truthful recent execution activity |
| Published artifact access | [Download backend](lld/run-artifact-downloads.md), [browser controls](lld/run-artifact-controls.md) | Publication evidence, native verified streaming and bounded browser inventory |
| Retained k6 metric windows | [Metric archive](lld/k6-metric-archive.md) | Bounded data/index artifacts, output partition and streamed final custody |
| Sealed metric history API/chart | [Metric history](lld/run-metric-history.md) | Scoped catalogue/sample reads, streamed proof and bounded chart ownership |
| k6 live duration estimates | [Distributions](lld/k6-distributions.md) | Bounded mergeable histograms, precision, numeric artifacts and acceptance |
| Per-attempt resource producer | [Attempt resources](lld/attempt-resources.md) | Owned Docker samples, truthful missing values, sampled peaks and event producer barriers |
| Scheduler or instrumentation | [Resources/observability](lld/resources-observability.md) | Admission, budgets, CPU/RAM, phases, telemetry limits |
| HTTP, CLI or browser | [Application/UI](lld/application-ui.md) | API routes, errors, events, queries, export, frontend |
| Performance report artifacts | [Engine reports](lld/performance-reports.md) | Mapped result and shared numeric presentation; admitted text/CSV custody |
| Standalone script component | [Engine export](lld/standalone-export.md) | Shared compiler/runtime builder and explicit secret refusal; HTTP/UI admission pending |

Cross-cutting implementation limits live in [engineering](../engineering.md).
Acceptance scenarios live in [verification](../verification.md). Read both for
any new component; do not duplicate their rules into every feature specification.

## Contract vocabulary

Organisation: top-level local namespace. Workspace: service/project namespace
inside it. Folder: optional nested grouping within one workspace. Suite revision: immutable,
engine-specific test definition. Run: user's logical request. Attempt: one actual
engine execution. Phase: bounded responsibility inside an attempt. Unit: engine-
native case, endpoint, scenario or mutant; it is not always a resumable checkpoint.
Artifact: immutable output with publication state and checksum. Event: ordered
control/progress/result record. Resource sample: scoped measurement, not progress.

No automatic retry of a test attempt. A user retry creates a new attempt linked
to the same run and prior attempt; report their outcomes individually. Resume is
limited to acknowledged transport and artifact processing in the first release.

## Completion rule

A run is finished only when execution termination is known and its result/artifact
seal is verified. Unexpected disappearance or missing evidence yields errored or
lost with an inconclusive outcome. Never infer passed from a heartbeat, UI state,
HTTP 200, progress percentage or process exit alone.

Target observation and large-body contracts: [target sampling](lld/target-sampling.md),
[request bodies](lld/request-bodies.md).
