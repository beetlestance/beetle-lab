# Actual producer retirement barrier

Status: C2c locally verified; matched Linux arm64 execution regression passed.
Owner [contract](../design/lld/producer-retirement.md), following
[durable intent](producer-retirement-store.md) and [shared leases](producer-gate.md).
No cleanup endpoint, native inventory/removal, physical ACK or refund is enabled.

## Result

The private runtime.retirement port composes the real Journal, shared gate and
installation owner. One coordinator per Journal, <=64 exact scoped entries and a
fixed whole-operation budget <=30s, starting before preflight. Intake stays open
through read-only preflight reservation; local fencing precedes atomic begin.
Unknown writes retain their actual carrier settlement before status reconciliation.
Every awaited phase/helper rechecks the owner before dispatching another read/effect.

Actual existing Manager leases, preparation, watches, cancellations and cached
controller closes drain. No recovered empty entry substitutes for ownership. Positive
never-started release requires no tokens/runtime and no actual actor remaining.
Settled release uses fresh exact stopped/missing Supervisor inspection without
create/start/remove or new lifecycle facts. Missing catalogue/profile/spec authority
stays unresolved. Controller shutdown fences old handles and waits actual telemetry
closes before deleting its actor; failed closes remain cached and owned.

Public result expiry is independent of actual promise settlement. Held originals
and uncertain/failed custody retain bounded ownership. Known fully drained originals
may evict after expiry without a token; retries inspect again under a fresh budget.
Success mints a WeakMap-backed process-local producer-quiescence token bound to the
exact intent/namespace/task snapshot. Closing the coordinator revokes it. This is
not native removal/absence authority. Shutdown drains coordinator before shared gate.

## Local evidence

Basea90b675; branch feature/producer-retirement-barrier. Canonical ignored evidence
is archived at .agent-work/producer-retirement-c2c/. Frozen affected lifecycle
lane:492 tests in63 files passed (192.606s command), including controller, Supervisor,
installation, bootstrap and new producer tests. Node types10.653s, lint6.714s,
architecture6.223s and agent build0.617s exited0.

Final helper-continuation correction:15 affected tests in3 files passed (9.354s);
Node types9.182s, lint6.461s, architecture10.857s and agent build0.695s exited0.
Other green checks were reused. Independent review found late read dispatch after
held carrier/get/helper settlement; corrected owner checks have regressions proving
no late reconciliation/allocation/Offer/inspect dispatch.

Coverage includes exact compiled Journal lost committed reply/termination/reopen,
held native/read/provider/actor close, unknown carrier failure, failed cached cleanup,
whole preflight/drain expiry, close/retry/reentrancy/capacity, genuine cold runtime
observations and private root composition. Model fixtures prove ordering only;
real-port tests separately exercise Journal/Manager/Supervisor/native filesystem
composition with a synthetic Docker backend. No hosted CI or release claim.

## Native execution regression

Code0332c0964c8a5d0f300dd9ced5d4367ad8f4473c built one matched Linux arm64 agent/
engine pair in a task-owned builder capped2CPU/2GiB/cache1GiB. Builder removed.
Agent image16.043s, engine image12.068s; native command13.159s, all exit0.
Host backend Node26.7.0/darwin arm64; agent/engine use the pinned Linux images.
One readiness/one work/zero unexpected requests, six artifacts, numeric4 history,
metadata reopen and exact backend charge104376 passed. Fixture resource cleanup
verified. Engine-log diagnostic unavailable is retained in evidence.

This exercises real k6/controller/telemetry close and publication, not a native C3
cleanup call or release/amd64 matrix. Private producer-barrier composition has
separate real-port/model evidence above. No image was published or user service
restarted. Qualification input hashes are rechecked before docs-only finalization.

## Remaining boundary

C3 must independently validate current native custody/runtime removal, persist the
actual bounded plan before unlink, replay progress and establish exact owned absence.
C4-C6 still own authenticated receipt delivery, accounting settlement and retention.
No-task/preparing/unreserved cleanup branches need their own reviewed native/control
policy. This packet preserves every disk hold and retained/control payload charge.
