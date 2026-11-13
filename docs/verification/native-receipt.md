# Durable native receipt evidence

Status: C3f private finalization locally verified; no runner ACK, refund or public
route. [Contract](../design/lld/native-receipt.md). Base41349b3; Journal020 additive.

One shared native original returns progress plus opaque whole-task absence only
after successful native closes/current absence and known final progress commit.
Existing step callers keep their coalesced progress facade. Finalization always
performs/joins real native proof before commit/replay, even with an existing receipt.
The worker validates immutable metadata; raw receipt reads are not physical authority.
Independent source review found no blocking findings and did not rerun checks.

## Scoped evidence

Host Node26.7.0/darwin arm64. Actual compiled SQLite worker and task-owned files;
portable native seams remain distinct from Linux proof. Private check-runner records
commands, inputs, exits, timings and any failures.

| Lane | Actual result |
| --- | --- |
| Initial receipt/existing steps | 10tests/2files passed,9.56s |
| Receipt provenance/carriers | 7tests/3files passed,10.45s |
| Schema19/accounting/raw SQL | 2tests passed,4.12s |
| Final composed Journal/native/plan/inventory/retirement/migration/bootstrap | 492tests/64files passed,201.12s |
| Node types/lint/architecture | Exit0;10.98s/7.75s/6.82s |
| Agent build/docs | Exit0;.89s/1.03s |

Final composed tests include the added failed-fresh-close regression. Forged or
foreign/revoked observations, final counters with existing files, a reappeared root
despite stored receipt and a failed current close cannot produce successful receipt
finalization. Held commit/worker termination retains the actual request/proof/slot;
shutdown or abort after commit produces no late success or compensation. Exact
committed receipt survives actual lost reply, termination and reopen.

Migration from actual schema19 preserves previous accepted/reservation/hold/stat/
event/retirement/plan/progress rows and schema roots/FKs. Only the bounded new receipt
is added, charged encodedBytes+512 inside the existing control buckets. Raw SQL rejects
wrong digest/closure/charge, replacement, update and delete. No payload/replay record
or logical quota is purged/refunded.

## Native scope

The native adapter's rebuilt bundle differed from C3e's qualified bundle, so evidence
was not reused merely because behavior appeared unchanged. The exact new bundle ran
on pinned Node24.22.2/Linux arm64 with networknone, twoCPUs/512MiB/128PIDs, no
capabilities, read-only root and64MiB disposable tmpfs. Exit0,.65s; seven planned entries
produced exactly seven effects while three committed unlink/fsync/final-root reply
failures recovered without extra effects. Final root absent, retained native owners0.
No daemon socket, user data mount or target load was supplied to that leaf fixture.
This is native filesystem proof plus portable compiled receipt composition, not a
complete native runner/backend cleanup qualification.

Authenticated C4 request/ACK composition, the conservative cold mailbox-association
gap, PhaseB settlement/tombstones and public retention apply remain pending. C4 must
consume trusted finalization, not a raw receipt read. User services were preserved.
