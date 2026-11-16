# Immutable cleanup-plan storage

Status: C3d metadata and observed-plan bridge implemented locally. Journal018.
Parents: [native inventory](task-inventory.md), [plan values](cleanup-control.md),
[retirement](output-retirement.md), [producer](producer-retirement.md).
No unlink, mutable removal progress, native receipt, ACK or refund.

## Provenance versus metadata

C3c success now exposes an opaque TaskPlanObservation only after actual original
closes and final native checks. A process-local WeakMap binds canonical plan bytes
and SHA256 identity, exact physical Journal retirement/plan ports, live runtime
absence capability and inventory owner. Neither a JSON value nor a stored row can
manufacture that provenance. Revoked producer/runtime/inventory owners invalidate it.
Publicly returned plan mutation cannot change its captured canonical observation.

The private inventory.persist port requires that observation. Capture one fixed
operation budget (at most30seconds); authenticate it again before dispatch and after
reply. No caller path, receipt flag or raw plan replaces the observation. Raw Journal
store/read ports remain metadata validation, explicitly not native IO proof. The
worker cannot establish complete inventory from four role anchors alone.

Retain at mosttwo metadata originals per inventory service; issued plan commands also
consume the existing Journal's two large-carrier credits and bounded queue. Reserve
before capture/reentrant inputs. Shutdown fences new work and awaits actual issued
promises; rejected workers require the existing actual termination barrier before
release. Unproven termination retains owner/slot and makes shutdown unresolved.
Budget expiry/abort after commit grants no late success and performs no compensation.
Exact retry reads/replays the same durable plan; no native inventory or target work
is repeated by this metadata port. A lost commit reply remains unknown until actual
carrier settlement and a fresh exact read/retry, never a missing-row timeout guess.

## Durable value and transaction

One immutable row per exact original stores canonical NativeCleanupPlan <=131072
UTF-8 bytes, its canonical SHA256 identity, exact encoded byte count and logical
charge encodedBytes+512. The512 row allowance uses the existing reserved metadata
bucket; no ordinary payload/spool charge or quota ceiling is changed. This is logical
accounting, not physical page/WAL preallocation or a full-disk guarantee.

Require existing immutable retirement, current eligible released original/closure
ACK, performance purpose, C1 namespace and prepared task anchor, controlversion1 and
reserved196608bytes. Match complete original, retirement request digest, namespace,
task identity and all four role native facts. Native identity equality does not prove
other entries exist; that belongs to the observation/native owner.

Exact canonical digest replay returns the stored plan. A changed plan conflicts;
no replacement/update/delete is permitted. SQL CHECK/UDF guards validate closed shape,
canonical bytes, digest and row charge. INSERT guards bind protected accepted,
retirement, reservation, installed/task rows and current ACK; typed store also reuses
full retirement eligibility. Reads validate lengths/identity/counts and scope, including
null replies. Scope or reply-kind mismatch fails the actual Journal carrier.

Private input command frames allow2×planBytes+4096 bytes for JSON-string escaping.
Read/reply frames bound the plan wrapper separately. Admission precedes capture;
validations occur before copying unbounded input. Quote/Unicode near-limit fixtures
exercise carrier bounds without granting native permission. Migration018 is additive;
predecessor rows, roots, spool/hold charges and foreign keys must survive unchanged.

## Subsequent destructive replay

Persisted metadata is necessary before unlink, never sufficient permission. Future
native removal must use this exact plan through a freshly qualified native owner,
revalidate its complete inventory/identities and retain actual unlink/fsync/close
progress across lost replies. It cannot turn an empty wrong root into a fresh plan.
Current raw store/read receipts do not advance backend cleanup or release disk holds.

Acceptance: observed-token provenance/revocation, immutable replay/conflict, wrong
scope/namespace/request/role/control, raw SQL digest/charge/update/delete guards,
compiled worker lost reply/termination/reopen, quote/Unicode carrier bounds, held
shutdown and additive schema17/accounting preservation. Native destructive and full
runner/backend qualification remain separate.
