# Run intake contracts and command evidence

Contract source: `1703126`; pure command: `5c8f09b`; storage: `bc01cb3`.
Environment: 2026-11-09, macOS arm64/Node26.7.0, synthetic fixtures only.
Scope: schemas/clients, pinned commands, migration004 and atomic metadata enqueue.
Run HTTP routes, dispatch and actual engine execution remain unimplemented.

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
the SQLite adapter now implements those ports. The [owning LLD](../design/lld/run-intake.md) defines the
receipt-first run/attempt/immutable Offer/outbox transaction.

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

## Atomic storage and recovery

The existing WAL worker now implements run enqueue/detail/page. One receipt-first
transaction binds a scoped immutable revision, currently published input pins,
resolved settings versions and a private pinned engine profile. It writes the run,
first attempt, exact Offer/registry identity and outbox reference together. Caller
requests cannot choose runtime images/config or resolve secret values. Empty
private registry refuses new enqueue; receipt replay and reads remain available.

Migration004 adds scoped active-attempt/revision FKs, immutable intent and REPLACE
fences, bounded pending/history indexes and explicit state/outcome constraints.
Generation remains null until a validated future agent observation. The first SQL
check accidentally rejected null; the failing enqueue tests caught and corrected it.
Applied001..003 are unchanged. Upgrade preserves prior namespaces/settings/revisions/
receipts; late migration/insert failure rolls back without partial records.

Three independent source reviews covered migration/worker composition, enqueue/read/
Offer binding, and shared secret translation. Review found UPDATE guards could be
bypassed by deleting/reinserting an uncertain outbox. The actual DELETE regression
first failed, then passed after retaining uncertainty until a generation is stored,
refusing acknowledged reinsertion/generation rewind and active run/attempt deletion.
Re-review closed the finding. A separate coverage note strengthened the maximum
secret declaration test to assert all64 ordered references, and re-review cleared it.
The active-delete predicates were source-reviewed; direct deletion assertions also
exercise existing FKs and do not independently isolate those two triggers.

Shared secret translation now lives in contracts and the wrapper delegates to it.
The bounded131072-byte snapshot accommodates64 maximum escaped versions; aliases,
provider/version equality and portable name collision checks remain. No lookup or
resolved content enters metadata. Normal executable profile loading and a genuine
agent capacity/identity bridge still need integration; programmatic test pins are
synthetic identities, not installed image provenance.

## Integrated checks at bc01cb3

The scoped storage/secret-binding run passed95 tests/19 files in50.32s. Correction
checks passed9 tests/2 files in1.91s. The final full `verify:v2` exited0: **3,086
tests/299 files in413.47s**, with generated contracts, all three TypeScript projects,
lint, architecture948, docs151 and frontend build passing. The bundle warning remains.
A detected type import cycle was removed by moving shared registry types into the
port contract; no gate was weakened.

`npm run build:api`, `npm run smoke:api` and `npm run smoke:input-controls` exited0
on this changed backend source. The compiled backend/SQLite/files checks use owned
loopback installations and verify old authoring/input workflows, lost input
acknowledgements, logout and clean shutdown. These do not exercise run HTTP because
those routes do not yet exist. No agent, external target or engine starts.

Public run routes, executable registry/capacity bridge, dispatch/cancel, event
cursors, verified artifacts/finalization and UI run/results remain required before
R2 or a complete workflow can be claimed. Native image evidence affected by shared
wrapper source needs renewed qualification. Browser/proxy, Docker/Compose,
architecture/resource, backup/soak and release qualification remain pending.
