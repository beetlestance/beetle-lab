# Cleanup-plan persistence evidence

Status: C3d locally verified metadata/provenance; no unlink, removal progress,
physical receipt, ACK or refund. [Contract](../design/lld/cleanup-plan-store.md).
Base35cdb59; Journal018 is additive and prior migrations are unchanged.

The private inventory port persists only genuine post-close TaskPlanObservation.
WeakMap provenance binds exact physical ports, live runtime/producer/inventory owners
and canonical native plan digest. Raw Journal receipts remain metadata-only. Store
requires exact protected retirement/task/namespace/role facts, released original,
closure ACK and existing control reserve; exact replay succeeds and changes conflict.
Failed carriers remain owned through actual termination. Independent source review
found no blocking findings and did not duplicate tests.

Private check-runner evidence retains commands, exits/times, source identity and
initial failures. Host Node26.7.0/darwin arm64; fixture compiles the actual SQLite
worker and uses actual task-owned files plus the documented portable native seams.

| Lane | Actual result |
| --- | --- |
| Initial Journal roundtrip | 7/8tests; raw lost-reply wrapper expectation corrected |
| Plan/retirement/namespace | 60tests/19files passed,36.99s |
| Schema17/accounting/raw SQL | 3tests passed,4.53s |
| Journal/inventory/plan/migration/bootstrap | 419tests/37files passed,130.31s |
| Additional observation immutability/port/deadline | 2tests passed,4.02s |
| Final Node types/lint/architecture | Exit0;9.84s/6.66s/12.02s (architecture reused unchanged source) |
| Agent build/docs | Exit0;1.10s/.59s |

Native SQL checks preserve every prior accepted/reservation/hold/stat/event/source/
delivery/absence/namespace/retirement row and existing schema root pages. Only the
new bounded plan row is added; its encodedBytes+512 logical charge stays within
C1's already reserved buckets. Foreign keys remain valid. Raw SQL rejects incorrect
role facts, forged digest/charge, replacement, update and delete. Synthetic legacy
fixtures may remove only empty new plan storage when reconstructing predecessors;
real retained plans are never discarded by a migration.

Actual compiled-worker tests withhold committed replies, terminate the original
carrier and reopen/read/replay exact metadata. Private persistence tests hold a
healthy commit reply through shutdown, cancel after commit and hold termination
settlement after worker failure; no late success or compensation occurs. Almost-full
quote and Unicode plans validate original escaped carrier bounds. Forged/revoked
observations and changed namespace/task/request/scope/role values refuse.

C3c Linuxarm64 native leaf evidence remains valid for its unchanged adapter; this
slice does not relabel portable composition as native cleanup qualification. The
next native destructive owner must revalidate the same persisted plan before unlink,
retain fsync/close/progress through reply loss and establish the physical receipt.
Runtime mailbox crash association, authenticated backend integration, separate final
settlement and public retention apply remain pending. No image was published or
user service restarted by this slice.
