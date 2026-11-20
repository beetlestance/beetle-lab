# Backlog

Status: active. Open product and release work. Current behaviour is described in
[capabilities](../system/capabilities.md); the acceptance ledger is an evidence
inventory, not a release certificate. Historical reports are indexed in
[evidence](../evidence/README.md).

## Open work

| Area | Gap |
| --- | --- |
| Release acceptance | Sampler confinement and the other corrections listed in [observations at a646d39a](../evidence/release-readiness-a646d39a.md) still need release acceptance on the integrated build. |
| Conformance | The original hosted conformance failure is unexplained; later passes do not establish its cause. |
| Storage faults | Native filesystem-stall injection has not been exercised; only real-worker and simulated stalls are covered. |
| Row validation | Settings rows were validated before the `40c4a5c1` qualification (`947b62e7`). Implemented in source since then: namespace, input metadata, recovery, run, suite, journal, dispatch and history rows, and bounded SQLite cells (`a47c6e22` to `42d96e12`). These are not yet qualified on an integrated build, and no audit shows every row family is covered. |
| Formatting | Implemented in source: authored-source formatting and line limits are enforced by `format:check` and lint in CI (`74a87dbc`, `049c4d5b`). CI at `5b8e016c` (run 44108058789) failed in checks, test shard 3 and the amd64 container, so no green run covers it yet. |
| Publishing | No replacement image is published; publication needs explicit authorisation after integration. |
| Design assets | The shared asset release declares GPL-3.0-only; distribution terms must be settled before bundling ([decision 019](../decisions/019-frontend-stack-and-engine-sdk.md)). |
| Presentation | Long report lines overflow the page horizontally; responsive visual quality is uncertified and belongs to the UI redesign. |

Each new migration needs its own upgrade test; that is a rule in
[verification](../engineering/verification.md), not a gap.

## Described but not built

Behaviour the retired low-level designs described and the code does not have.
None is committed work; each needs its own plan before it starts.

| Area | Not built |
| --- | --- |
| Public API | SSE live event stream with cursor resume; explicit run retry (a new attempt under one run; generation is fixed at 1); an unauthenticated `/capacity` (the authenticated `getInstallationStatus` reports pool and host capacity) |
| Namespaces | Recursive organisation and workspace cleanup that frees retained rows and bytes |
| Execution | Process (non-Docker) backend; browser and mutation engine profiles; per-profile cancellation grace; checkpointed work units; explicit finalisation ACK endpoints; a container retention sweeper |
| Events | Rebuilding event coverage marked `partial`; recovery authority for blocked event problems (`quota_exhausted`, `missing_receipt`, `replay_conflict`) |
| Resources | Backend data-root disk observation with its own reserve; qualified idle and thermal producers; a reserved guard lane in the agent scheduler if guard freshness needs it; OpenTelemetry export |
| Outputs | A durable run pin for retention; closure for attempts without wrapper exit evidence (they stay pending `exit_evidence`); tombstone expiry behind a non-replay fence; a retention rule for global mutation receipts; the cold mailbox-volume association gap |
| Exports | External-secret export modes; cleanup, retirement and settlement of standalone-export output |
| Results | Arbitrary live series selection and replay; retention of raw k6 diagnostics |
| Storage and deployment | S3 artefact store, optional PostgreSQL and multi-instance shared mode; remote TLS and multi-agent ownership; writable or in-place restore ([decision 016](../decisions/016-historical-restore.md)); a constrained Docker broker ([decision 018](../decisions/018-docker-host-trust-boundary.md)) |
| Release | Published pull installation, SBOM and image scans, measured stack overhead |

## Evidence boundaries

Historical source CI passed at 4fabd9fa; see [the evidence index](../evidence/README.md).
Recorded native Linux amd64/arm64 checks and the 30-minute stream remain useful
within their original inputs. Neither a passing fixture nor a historical closeout
establishes complete real-workload parity or readiness after unrelated changes.
Scoped browser functionality passes in an isolated Playwright container. Release
protections are applied; publication still requires explicit authorisation.

## Separate scope

A full UI redesign, additional engines, generated test cases, shared PostgreSQL/S3
storage and multi-user IAM are later phases. Report content and basic configuration
usability are functional work, not deferred visual polish.
