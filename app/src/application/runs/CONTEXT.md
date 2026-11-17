# Run intake

Public entrypoints: prepareRunCommand, enqueueRun, getRun, listRuns,
prepareCancelRunCommand and cancelRun in index.ts.
Command inputs are one create operation and trusted digest. Output is a frozen
<=64 KiB command; strict public request,
distinct UUID allocations and timestamp are validated. Canonical request digest
excludes allocations/time so exact replay preserves original IDs at the store.
Enqueue calls RunStore once; that port owns receipt-first atomic
run/attempt/Offer/outbox acceptance. Replay binds intent while retaining original
IDs/time. Reads call RunReader once and remain observational. Expected inputs are
captured before awaits. Run replies are <=64 KiB; pages <=1 MiB, <=requested limit,
unique IDs and exact workspace ownership. Invalid replies fail without retry.
Cancellation captures a <=64 KiB command binding scope, run and request ID, calls
RunCancellationStore once and validates intent/terminal acceptance. No agent call
or physical stop/release is inferred. Store owns claim serialization and receipts.
setRunNote (note.ts) captures a <=64 KiB scoped command (expectedNoteVersion, note or
null), trims notes by name rules (<=1000 scalars, fold <=4096) and calls RunNoteStore once.
pin.ts: prepareRunPinCommand digests kind/run/request (never the server clock); pinRun
calls RunPinStore once and checkedRunPinReceipt binds scope, run, request ID and direction.
Contracts: docs/system/contracts/run-lifecycle.md. Checks: app/test/{runs,application/runs}
and app/test/http/runs; Node TS and scoped lint.
