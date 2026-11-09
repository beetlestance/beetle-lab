# Low-level design map

Status: v2 design with partially implemented contracts and components; [PLAN](../../PLAN.md) records current coverage.
The owning document below must be updated before its implementation changes.

| Implementing | Read | Includes |
| --- | --- | --- |
| Organisation and settings | [Organisation/settings](lld/organization-settings.md) | Hierarchy, scoped access, folders, inheritance and safe settings changes |
| Source/build layout | [Module map](lld/module-map.md) | Package tree, named owners, import graph and build boundaries |
| Domain and storage | [Domain/storage](lld/domain-storage.md) | State, tables, transaction ownership, artifacts, secrets |
| Durable dispatch/storage | [Dispatch storage](lld/dispatch-storage.md), [output allocation](lld/output-allocation.md) | Claim/ACK/recovery, bounded isolation and shared byte reservations |
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
| Mounted input/secret intake | [Installed providers](lld/installed-providers.md) | Scoped lazy input streams, explicit aliases, bounded private files and original cleanup |
| Agent executable/container | [Executable agent](lld/executable-agent.md) | Private configuration, shipped schema bindings, signal ownership and image boundary |
| Private runner HTTP | [Agent HTTP](lld/agent-http.md) | Credential/scope fences, bounded runner DTOs and request ownership |
| Scheduler or instrumentation | [Resources/observability](lld/resources-observability.md) | Admission, budgets, CPU/RAM, phases, telemetry limits |
| HTTP, CLI or browser | [Application/UI](lld/application-ui.md) | API routes, errors, events, queries, export, frontend |

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
