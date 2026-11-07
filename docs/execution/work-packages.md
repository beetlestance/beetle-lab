# Work packages, dependencies and effort

Status: proposed queue. All packages are planned, not ready or running.
Read [schedule](schedule.md) for capacity/locks and [packets](context-packet.md)
for the actual dispatch contract. Split a package into 1-3-hour behavior packets
where useful; keep its acceptance and single owner intact.

## Package graph

| ID | Behavior/output and primary write ownership | Depends on | Default model | Task-hours |
| --- | --- | --- | --- | --- |
| W00 | Workspace, generators, check commands, import/size/doc gates, packet preflight; root tools/config | Design snapshot | Coordinator/Sol | 2-4 |
| W01 | JSON contracts, generated clients, state/result vocabulary, protocol fixtures; contracts/ | W00 | Sol high; Astra review | 2-4 |
| W02 | Organisation/workspace/folder identities, transitions/settings resolver; app/domain and application | W01 | Sol high | 2-3 |
| W03 | SQLite worker, scoped repositories, schema transactions and artifact lifecycle; app/outbound storage | W02 | Sol high | 3-5 |
| W04 | Agent SQLite journal/atomic reservation foundation plus fake-engine framing/replay harness; agent/journal + test/conformance | W01 | Sol high; Luna fixed-vector fixture subtask | 3-5 |
| W05 | Aggregate reservations, parallel/isolated policy, queue reasons; agent/admission | W01,W04 | Sol high; Astra review | 3-5 |
| W06 | Docker supervisor, idempotent create, cancel/restart/fencing; agent/supervisor/backends + reserved journal extensions | W05 | Sol high; Astra review | 5-8 |
| W07 | Scoped resources, useful progress, bounded telemetry, capability reporting; agent/telemetry | W06 | Sol high | 2-4 |
| W08 | k6 suite compiler, all executors, data/checks and shared export compiler; engines/k6/compiler/runtime | W01 | Sol high | 4-6 |
| W09 | Wrapper, metric aggregation, target sampler, result/seal pipeline; engines/k6/wrapper/aggregation/results | W06,W07,W08 | Sol high | 4-6 |
| W10 | Fastify scoped API, sessions, outbox, ingest/reconciliation, settings; app/inbound/http/outbound/runner | W03,W06 | Sol high | 4-6 |
| W11 | React shell/router/query ownership, motion primitives, fake API fixtures; web/app/components | W01 | Sol medium | 3-5 |
| W12 | Organisation/folders/settings/revision editing views; web/features workspace/suites/settings | W10,W11 | Sol medium | 3-5 |
| W13 | Queue/live results, reconnection, bounded charts and scope switching; web/features/runs | W09,W10,W11 | Sol high | 3-5 |
| W14 | Reports/comparison/download/export use cases; engine export + app/web artifact features | W08,W09,W10,W11 | Sol high | 3-5 |
| W15 | Matched frontend/backend/agent/engine images, proxy/Compose, multiarch CI; root release files | W09,W10,W11 | Coordinator/Sol | 3-4 |
| W16 | Cross-boundary failure/security/resource fixtures; test/conformance and owner tests | W07,W09,W10,W13,W14 | Sol high, independent reviewer | 3-5 |
| W17 | Final vertical integration, feature ledger and documentation/evidence; integration branch | W12-W16 | Coordinator/Sol; Astra opinion | 2-4 |
| Q01 | Secret/dependency/image scans, SBOM and distribution license inventory | W15,W17 | Coordinator/Sol | 1-2 |
| Q02 | Fresh install, consistent backup/restore and supported future-v2 rollback fixtures | W03,W15,W17 | Sol high; coordinator execution | 1-2 |
| Q03 | Bounded soak, repeated-run resource cleanup and telemetry off/on overhead | W07,W15,W17 | Coordinator; exclusive host lane | 2-4 |
| Q04 | Independent native linux/amd64 and linux/arm64 real-engine execution | W15,W17 | Coordinator/Sol | 1-3 |

Implementation W00-W17: 54-89 task-hours. Qualification Q01-Q04: 5-11 active
task-hours, including the specified bounded soak, excluding native runner
procurement/user waits and extended field trials. Independent review/rework: an
additional 12-25 hours. Total initial planning allowance: 71-125 task-hours.
These are seed estimates, not model benchmarks. Re-estimate after calibration.
Relative packet sizes: S = one behavior and oracle; M = 2-3 related cases; L = split
before dispatch. Track actual time separately from this qualitative sizing.

## Dependency semantics

Dependencies require consumed interface guarantees accepted on the integration
baseline: independent review plus focused seam tests at that SHA. Coordinator
records both integrated and accepted when that evidence passes. Code merely
submitted or reviewed on a private branch cannot unblock a dependent. A worker
never creates its own meaning for an absent dependency. Packet preparation resolves
the actual dependency commits and hashes before a task becomes ready.

W10 may initially qualify against the fake engine after W06; the real k6 lifecycle
must still pass before W17. W11 uses generated types and contract fixtures, not a
handwritten parallel API. If W12 only needs a stable subset, a smaller packet may
start after that subset is integrated and named explicitly in its dependencies.
No speculative branch chain is accepted just to keep all slots busy. W04 owns
the journal transaction seam before W05 admission uses it; W06 extends it only
through a reserved schema change. First vertical checkpoint: accepted W03/W04 and
minimal accepted W06/W10 packets produce enqueue -> fake execution -> sealed result
before expanding the complete k6/UI surface. Name the subset guarantees explicitly.

## Acceptance map

| Packages | Minimum handoff evidence |
| --- | --- |
| W00-W01 | Reproducible generation, clean typecheck, import/size negatives, packet corruption/staleness tests |
| W02-W03 | A01; V10,V19-V21; wrong-parent FKs, transaction rollback, settings snapshots and deletion recovery |
| W04-W06 | V01-V07,V11-V12,V15,V17,V22; no duplicated load or stale completion; isolation support recorded |
| W07 | V08-V09,V13-V14,V24; target/engine/control scopes distinct; no invented function CPU/RAM |
| W08-W09 | A02-A03,A06-A09; compiler parity, expected discovery abort, all seven executors and sealed results |
| W10 | A01-A02; V02-V05,V12,V16,V19,V21,V23; Fastify/schema bridge and namespace/session negatives |
| W11-W13 | A01-A03,A05; route/query ownership, SSE gaps, two-org switch, keyboard/themes/reduced motion |
| W14 | A04; V10,V15,V19; four-run cap, streamed exports, secret-safe snapshots and no silent feature omission |
| W15-W17 | Real Compose run, exact-source CI and current-feature ledger; candidate integration evidence |
| Q01-Q04 | Supply-chain reports; backup/restore/rollback; resource/overhead; native image/engine evidence, each with its exact source |

Tests are behavior evidence, not snapshots of implementation choices. Fixture authoring is not automatically low-risk: expected outcomes need an
independently established oracle before Luna prepares variations. The reviewer
checks a failure oracle independent of the author's code (e.g. duplicate offer
must produce one target request stream, not merely one mocked function call).

## Qualification states

Q04 is blocked if either native runner is unavailable; a multiarch manifest or
emulated build is not a substitute. Q03 owns the resource fixture in verification,
not an arbitrary all-night load test. Manual keyboard/zoom/accessibility review is
recorded separately with its owner and remaining gaps; automated axe is not that
review. Missing tools/authorization create explicit blocked states. Source fixes
during qualification invalidate affected evidence and are reviewed before rerun.

## Shared-file owners

Coordinator serializes root package/lock/tsconfig, schema IDs/generation,
CI/Compose/image release manifests, migration numbering, doc indexes and the
integration acceptance ledger. An assigned storage worker can author a named
SQLite migration, but its numbering/schema contract is reserved first. Workers
propose new dependencies; coordinator pins/integrates them before dependent work.

Normal owners implement their module tests and the owning LLD corrections. Other
workers treat those write paths as read-only even in a separate worktree; overlapping
public interfaces require coordinator sequencing, not last-writer-wins merging.

## Decisions that affect packet readiness

- Authoring is settled: form plus JSON editing, both using the same config schema.
- Secrets are supplied by environment or mounted files; metadata stores references
  only. No UI-managed plaintext credential persistence in this release.
- Raw shell hooks are retired in favour of explicit capability-controlled tool
  steps. F34 requires a documented approved-tool contract and typed failure evidence.
- Shared asset terms: use independent neutral placeholders for structural UI
  fixtures; distribution/branding packets remain blocked until terms are settled.
- Reference engine template only; no published SDK for the first release.

## Task-sizing rule

Each packet has one observable behavior and named files/tests. A nominal 5-8-hour
package such as W06 is several packets: journal/idempotency, create/reconcile,
cancel/kill, then crash/fencing negatives. Do not give an agent eight hours of
unbounded architecture ownership and hope a larger context window prevents drift.
