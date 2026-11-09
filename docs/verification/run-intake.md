# Run intake contracts and command evidence

Contract source: `1703126`; pure command correction: `5c8f09b`.
Environment: 2026-11-09, macOS arm64/Node26.7.0, synthetic fixtures only.
Scope: schemas, generated clients, pinned request semantics and pure command port.
Database run tables, enqueue routes and dispatch are not implemented by this slice.

## Defined boundary

CreateRunRequest accepts saved revision, profile, budget and policy within a
workspace. Runtime image/config/paths/secrets are rejected as caller fields.
Run and bounded RunPage describe compact snapshots without embedded config/events.
The client binds enqueue revision/profile/budget/policy, detail identity, page scope
and state/outcome consistency. Client checks do not establish actual exit or seals.

prepareRunCommand snapshots strict JSON, validates distinct allocated UUIDs and
schema-derived timestamp, computes the existing canonical request digest excluding
allocation IDs/time, checks any supplied prior digest, bounds the final command to
64KiB and freezes it. It performs no I/O or retry. RunStore/RunReader are ports;
no adapter is claimed. The [owning LLD](../design/lld/run-intake.md) defines the
receipt-first run/attempt/immutable Offer/outbox transaction required next.

## Independent review and corrections

The contract opinion found that finished/inconclusive discovery could not pass
the client guard. A completed discovery run can exhaust its range without reaching
the stop rule. The detail regression first failed, then passed after allowing that
truthful terminal outcome. An actual shipped k6 mapper fixture now produces
completed/complete/inconclusive and passes through detail and history clients.
Independent re-review closed the finding. Private registry manifest/profile/schema
pins are explicitly required beside Offer; its public selector alone lacks those pins.

Command review found that outer padding could fill the input bound and digest
addition could exceed the output bound. Against the committed prior source, the new
padding and tampered-digest tests failed (2 failed/3 passed). The correction rejects
unknown outer fields, checks stored digest and bounds the named final command;
all5 tests passed, and independent re-review found no blocking findings.

## Checks and limits

Contract generation/conformance/client tests passed220 across10 files in5.29s.
The discovery/run-command/k6-result scope passed139 across9 files in4.28s.
A later contract/command/actual-mapper scope passed225 across12 files in5.73s,
before the two final command-bound regression cases were added. Final command
checks passed5 cases. The final combined contract/command/mapper check passed
227 tests/12 files in6.50s at `5c8f09b`, with API generation, Node/frontend
TypeScript, scoped lint, architecture936 and docs149 all exiting0.

Initial descriptor tests failed for missing new route fixture mappings; these were
added without changing assertions. The first command test used an unavailable
runner timestamp primitive; it now reuses the RunTimestamp API schema. The docs
gate caught an oversized context note; it was shortened. The architecture gate
caught crypto in a test under core source; the test moved to app/test/runs.
No validator, structural threshold, timeout or test gate was weakened.

These are scoped functional/source-review checks, not a full gate on the new run
contracts. The prior3,048-test gate belongs to the earlier input-controls source.
Run enqueue/restart/receipt SQL, private installed profile registry, capacity bridge,
dispatch/cancel, event cursors, verified artifacts/finalization and UI run/results
remain required before the complete path or R2 can be claimed. Browser, Docker,
architecture/resource and release qualification are separate and remain pending.
