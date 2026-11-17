# Beetle Lab implementation plan

Current implementation and release gaps are owned by [STATUS](docs/STATUS.md).
[Feature inventory](docs/current-features.md) records the original capabilities;
[acceptance requirements](docs/verification/final-acceptance.md) retain all 69 IDs.
Historical task estimates and execution reports are indexed in
[HISTORY](docs/HISTORY.md). A previous closeout is not blanket release acceptance.

## Accepted direction

Ship through Docker Compose with separate frontend, backend and bounded execution
containers. Engines are pluggable. Keep single-administrator access, durable history,
explicit budgets and retention. Linux containers on amd64 and arm64 are targets;
native macOS/Windows and process-mode qualification are not first-release targets.

Use the existing SQLite-backed metadata/journal and filesystem artifacts for the
single-host profile. Shared PostgreSQL/S3 storage and multi-user IAM are later
design work.
No legacy application data migration is required. Preserve existing rewrite data
when implementing supported resource or installation changes.

## Delivery phases

| Phase | Scope |
| --- | --- |
| R0 | Workspace, contracts, dependency rules and bounded primitives |
| R1 | Admission, journal, container execution, cancellation and recovery |
| R2 | Complete k6 path, scenarios, assertions, datasets and target observations |
| R3 | Organisation/workspace UI, settings, API, history, reports and exports |
| R4 | Supported installation, native/resource/failure qualification and evidence |
| R5 | Additional engines such as Playwright and mutation adapters |
| R6 | Test-case authoring and generation with reviewable outputs |
| R7 | Optional shared storage, remote agents and hosted authorisation |

R0–R3 have substantial implementation. Known parity, configuration and hardening
gaps remain, and R4 release acceptance is open. The current backlog is maintained
once in STATUS.md. A functional report or resource-control gap is not UI polish.
The full UI redesign follows a separate audit and plan.

## Ownership and scope

[HLD](docs/design/HLD.md) and focused LLDs own architectural contracts;
[engineering](docs/engineering.md) owns implementation conventions;
[verification](docs/verification.md) owns required checks and evidence rules.
Use one task owner per shared boundary and preserve the agreed failure/resource
invariants. Do not introduce another framework merely to close a bounded defect.
