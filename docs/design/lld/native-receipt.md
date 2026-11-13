# Durable native cleanup receipt

Status: C3f private native/metadata boundary locally implemented. Agent Journal020.
Parents: [native removal](native-removal.md), [plan storage](cleanup-plan-store.md)
and [retirement](output-retirement.md). No runner/backend ACK, refund or public route.

## Physical provenance

NativeRemoval has one internal original carrying progress and optional opaque absence
proof. Existing step() exposes its cached progress facade; trusted stepWithProof()
shares that SAME original and cannot issue another effect by joining it. Only after
successful native absence, actual original closes and positively known final progress
commit may the owner mint NativeAbsenceObservation. A WeakMap binds captured canonical
plan/final progress, exact Journal retirement/plan/progress/receipt ports, live runtime
absence and native owner. Mutable returned progress cannot alter that captured proof.
A JSON object, counter or caller boolean cannot manufacture it.

NativeReceipt.finalize accepts genuine current RuntimeAbsent, a verified installed
root and the actual native removal owner. Require the same persisted plan and
files_absent progress before invoking the native owner. Always perform a fresh native
NOOP absence check (or join its owned final original): exact installed namespace and
marker, current task-root absence, actual parent fsync and every cached original close.
Even an existing receipt row cannot skip this proof. Reappeared task roots, failed
closes or revoked owners refuse. Authenticate the opaque observation, then commit its
bound NativeCleanupReceipt; recheck operation/capability/owner before dispatch and
success. The receipt's closure is owned-task-absent-after-original-close-v1.

## Lifetime and limits

One receipt owner per physical Journal, at mosttwo coalesced scoped originals. Reserve
before input capture, snapshot one <=30second budget and retain request/proof/carrier
through settlement. A held commit reply cannot create another native effect. Worker
failure awaits the existing actual termination barrier; ambiguous termination retains
the entry and makes close unresolved. Deadline/abort after commit produces no late
success and no compensation. Shutdown closes receipt before native removal, inventory,
runtime, producer and Journal owners. Failed native custody remains in its own owner.

The existing Journal large-carrier credits bound metadata capture. Native proof
reuses the same cleanup registry/descriptor bounds; no independent file pool is added.
The receipt body is <=4096 UTF-8 bytes. Wrapper/command/reply bounds include scope,
plan identity and canonical digest. Exact reply scope/digest must match the original.

## Atomic durable state

Journal020 adds one immutable receipt row per exact stored plan/original. Require
current eligible released retirement and files_absent progress; validate the exact
receipt codec against that plan and progress, canonical body/digest and actual byte
count. Exact replay returns the same record; changed binding/shape conflicts/refuses.
SQL insertion guards and immutable UPDATE/DELETE guards protect it. Row presence is
atomic cleaned METADATA state, not an independent physical fact.

Encoded receipt bytes+512 logical row allowance use C1's existing receipt/row buckets.
No spool, holds, quota ceilings, payloads, event/source/absence metadata or replay
identity are purged/refunded. Lost commit replies recover the same immutable row
only after actual carrier settlement; native finalization still requalifies absence.
Raw Journal receipt reads/commits are metadata plumbing. C4 must consume the trusted
finalization boundary and exact authenticated binding, never treat a raw read alone
as current IO authority or a shortcut to backend acknowledgement.

## Acceptance and limits

Actual cleanup then receipt/replay; final metadata without physical absence;
reappeared root despite stored receipt; forged/foreign/revoked proof; failed fresh
close after earlier final proof; held/cancelled/failed commit and actual termination;
compiled worker lost reply/reopen; schema19 preservation, charge/digest/closure and
immutable raw SQL guards. A native Linux leaf and portable real-Journal composition
remain distinct from full compiled runner/backend cleanup qualification.

Privileged host mutation remains outside atomic filesystem guarantees. Lost cold
mailbox association still refuses conservatively. Runner ACK, PhaseB settlement and
public retention apply require their separate contracts and composed evidence.
