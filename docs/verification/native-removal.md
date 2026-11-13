# Native single-step removal evidence

Status: C3e locally verified; no public route, physical receipt, backend ACK or refund.
[Contract](../design/lld/native-removal.md). Base1d7f012; Journal019 is additive.

The coordinator uses genuine current producer/runtime and C1 authority, a persisted
plan, actual shared native custody and monotonic progress. It serializes through
actual native AND metadata-carrier settlement. A failed close retains its native
owner/scope/credit and the coordinator entry. Scope and charges remain retained.

Independent review found one initial-state ordering issue: begin skipped prepared
presence validation by immediately entering cleaning. The fix persists prepared1,
requires COMPLETE presence, commits cleaning0, and strictly rechecks under the SAME
lease before effect. Only resumed cleaning permits exact-next uncertain absence.
The reviewer accepted this correction with no remaining blocking findings and did
not duplicate checks. Regressions cover missing-next before the first call and loss
of the next leaf during the held cleaning commit reply.

## Scoped checks

Host Node26.7.0/darwin arm64; real compiled SQLite worker, native task-owned files
and documented portable descriptor/mount seams. Full command/exit/timing/failure
records are private source-bound check-runner artifacts.

| Lane | Actual result |
| --- | --- |
| Initial single-step | 4tests passed,4.88s |
| Failure/progress | 9tests passed,9.46s |
| Held progress/genuine cold recovery | 2tests passed,4.94s |
| Native SQL/migration | 7tests passed,6.16s (includes step assertions) |
| Review correction | 15tests/6files passed,14.28s |
| Composed Journal/native/plan/inventory/retirement/migration/bootstrap | 481tests/60files passed,189.64s |
| Public-entrypoint composition | 58/59passed; unsupported-platform test counted prior fixture opens; corrected to compare new opens |
| Corrected step file | 7tests passed,5.49s |
| Final types/lint/architecture/build/docs | Exit0;10.60s/8.15s/5.20s/.79s/.51s |

Initial type/complexity failures are retained. Named helpers/ordered close routing
preserve responsibility and gates; public native adapter entrypoints replace deep
private imports. Unaffected green migration/Journal cases were reused after these
composition corrections rather than repeating that entire lane.

SQL evidence preserves previous plan/accepted/hold rows, schema root pages and FKs
across schema18 upgrade. Raw progress skips/rollback/identity/charge changes/delete
refuse. Worker lost replies reopen exact committed progress. Held progress reply
cannot trigger a second unlink. A fresh Journal, ProducerRetirement, Manager,
Supervisor and RuntimeRetirement recover the SAME partial plan with zero new engine
create/start calls and no restaging. Root disappearance before its final turn,
non-next missing entries, extras and removed-entry reappearance refuse before effects.

## Native Linux leaf

Current bundled native removal adapter ran on pinned Node24.22.2/Linux arm64 in the
retained task image, with networknone,512MiB/twoCPUs/128PIDs, no capabilities, read-only
root and64MiB disposable tmpfs. It had no Docker socket or host data mount.
Final exit0,.66s. Seven planned entries produced exactly seven unlink/rmdir effects.
Three injected committed first-unlink, parent-fsync and final-root reply failures
reconciled without extra effects. The initial prepared-presence path and resumed
cleaning paths both ran; final task root was absent and native retained count0.
Earlier native passes were superseded only after relevant state/import corrections.

This qualifies the native leaf, not a complete native Journal/runner/backend cleanup
chain. Whole-task durable receipt, mailbox crash association, authenticated ACK and
separate final settlement remain pending. No disk-hold refund, user-service restart
or published image change occurred. Privileged external leaf mutation remains outside
an atomic snapshot/compare-and-unlink guarantee.
