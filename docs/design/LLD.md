# Low-level design map

Status: v2 design with partially implemented contracts and components; [PLAN](../../PLAN.md) records current coverage.
The owning document below must be updated before its implementation changes.

| Implementing | Read | Includes |
| --- | --- | --- |
| Organisation and settings | [Organisation/settings](lld/organization-settings.md) | Hierarchy, scoped access, folders, inheritance and safe settings changes |
| Source/build layout | [Module map](lld/module-map.md) | Package tree, named owners, import graph and build boundaries |
| Domain and storage | [Domain/storage](lld/domain-storage.md) | State, tables, transaction ownership, artifacts, secrets |
| Dispatcher, agent or engine | [Execution protocol](lld/execution-protocol.md) | APIs, envelopes, idempotency, fencing, cancellation, recovery |
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
