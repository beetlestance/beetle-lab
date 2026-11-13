# Shared producer and reader leases

Status: C2b locally verified; C2c whole-producer barrier remains pending.
Owner [retirement contract](../design/lld/producer-retirement.md), following
[C2a durable storage](producer-retirement-store.md). No cleanup route is enabled.

## Behavior

One explicit gate per physical Journal retirement port and installed namespace is
shared by bootstrap, Stager, installation drive and output reader. At most64 scope
entries/leases and4 retained originals per lease. Scope and budgets/chunk selectors
are captured before foreign awaits; each original slot is reserved before its
factory. Durable-open observation is followed by another local fence check before
native work. Later staging and drive guards refuse a new forward effect.

Preflight reservation leaves intake open. An explicit local fence refuses new
leases; positive confirmation rereads the exact durable retirement intent. Prior
actual lease originals must drain before local eviction. A stored intent or empty
gate still provides no whole-producer or native cleanup permission.

A source lease owns its actual range result, quiescence and single cached close.
Factory uncertainty or failed quiescence/close poisons and retains the lease and
process-global source credit, fencing the scope against retries. Business failure
with successful actual cleanup releases its credit. Strong active gate ownership
survives loss of a service handle; retained entries remain bounded.

Stager owns its lease through existing actual provider/kernel/descriptor quiescence.
Drive retains its actual active work and Manager owner. Failed final driver cleanup
poisons rather than clearing the lease. Cached gate shutdown waits actual leases;
unknown cleanup prevents Journal closure and runtime reuse.

## Evidence

Base22c4267; task branch feature/producer-read-gate. Source-bound plan/reports and
failures live in canonical ignored .agent-work/producer-gate-c2b/. Final focused
lane:93 tests in11 files passed,29.596s command. Node types9.823s, lint6.368s,
architecture11.048s and agent build0.628s exited0. Expanded consumer lane passed
384/388 tests across61 files; three typed-refusal regressions were corrected and
30 affected tests in6 files passed (13.88s). One loopback bind was sandbox-denied;
the isolated authenticated HTTP file passed23 tests with approved fixture networking
(25.22s). Final source gates: Node types9.661s, lint6.525s, architecture5.945s,
agent build0.595s and docs0.235s exited0. Unaffected greens were reused; failures and
scoped corrections remain recorded in the same evidence directory. No published image, hosted CI or release claim.

Tests cover local/durable read-start races, held actual result/quiescence/close,
sticky failed source cleanup, pre-factory capacity, shared-port ownership, held
provider and driver originals, failed cached watch close, shared bootstrap wiring
and refusal of clean runtime shutdown after poisoned custody.

Independent review found that driver finalization freed a lease after failed native
cleanup; the corrected path retains/poisons it, with regression evidence. Reopened
fixtures now explicitly bind a gate to the new Journal port and original namespace.
One development lane saw changed tests against a cached earlier interface; its
mixed-source failure is retained and superseded by the frozen final lane.

## Remaining boundary

C2c must drain the actual existing Manager/controller/watch/supervisor owners or
inspect exact cold released runtime, settle the original Journal write carrier and
apply one fixed whole-barrier budget before minting a C3 capability. This gate alone
cannot establish runtime removal authority, inventory, physical absence, ACK,
purge or refund. C3-C6 and the unadmitted/legacy capacity branches remain separate.
