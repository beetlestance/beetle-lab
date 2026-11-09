# Run intake

Public entrypoints: prepareRunCommand, enqueueRun, getRun and listRuns in index.ts.
Command inputs are one create operation and trusted digest. Output is a frozen
<=64KiB command; strict public request,
distinct UUID allocations and timestamp are validated. Canonical request digest
excludes allocations/time so exact replay preserves original IDs at the store.
Enqueue calls RunStore once; that port owns receipt-first atomic
run/attempt/Offer/outbox acceptance. Replay binds intent while retaining original
IDs/time. Reads call RunReader once and remain observational. Expected inputs are
captured before awaits. Run replies are <=64KiB; pages <=1MiB, <=requested limit,
unique IDs and exact workspace ownership. Invalid replies fail without retry.
No dispatch, agent call, cancellation or execution is implemented here.
Contract: docs/design/lld/run-intake.md. Checks: app/test/{runs,application/runs}
and app/test/http/runs; Node TS and scoped lint.
