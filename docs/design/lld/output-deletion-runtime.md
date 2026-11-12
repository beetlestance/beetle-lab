# Backend file deletion driver

Status: implementation contract; does not authorize producer cleanup or refund.
Extends [durable progress](output-deletion-store.md) and
[native deletion](output-deletion.md).

## Ownership and admission

The installed output runtime owns one sequential deletion driver alongside its
publication/export children. It supplies the existing bound OutputDeletionMetadata
and the SAME native output-byte/deletion instance and namespace lease. No second
native store, worker, queue, compiler or deletion implementation is introduced.
Existing global native two-job and per-token admission remains authoritative.

Only committed pending intents are discovered. This driver never selects runs,
creates intents, accepts browser paths or interprets retention settings. Producer
facts, events, payloads, sources, input pins and ALL charges remain unchanged.
Files_absent remains backend-file progress, never whole-run deletion.

## One bounded step

Scan at most one pending intent per discovery call using the existing canonical
forward cursor; wrap after a completed page. Remember at most one current intent,
its next ordinal and the discovery cursor. At most128 files belong to an intent.
Process one ordinal per turn; skip already absent rows without native work. Resume
from durable metadata after restart, never an in-memory receipt. Each step has one
fixed30s monotonic budget, including metadata and native work and final settlement.

Capture/bind capabilities before startup yields. Bound/snapshot replies and match
scope/run/deletion/ordinal/version before native dispatch. The metadata RPC remains
the complete row-validation owner; native deletion validates its exact record and
returned plans. A mismatched row cannot authorize another file's deletion.

For pending_preparation, retain the actual prepareRemoval result and its settled
promise, then persist that exact plan through recordPlan. No unlink occurs in that
step. For prepared, reconstruct only its persisted plan, remove through the native
owner, retain result/settled originals, then record the exact absence receipt.
Do not synthesize preparation identities or infer success from missing files.

An unknown metadata write leaves its durable row authoritative: the next step
reads it again. Unknown native absence reuses the same stored plan. Never allocate
a replacement intent/token or retry an effect before its original settles.

## Failure and lifetime

Busy token/global native admission is deferred to a later bounded timer turn.
A separate fixed deadline watchdog fences and notifies while metadata is held.
Cancellation/deadline may end caller interest; all issued metadata/native result
and settled originals remain owned. A native failed close keeps settled pending,
retaining the child and namespace through shutdown. No detached cleanup or timeout
race releases custody. Permanent invalid/custody/IO failures fence the driver and
notify the output runtime once; no hidden infinite correction loop.

Close synchronously stops timers and new admission, aborts the active budget and
awaits every issued original. The parent closes all children and transfers before
releasing native files. Startup failure drains any already-owned child. Metadata
and the native store remain externally owned by their existing composition roots.

## Acceptance

Cover bounded discovery/ordinals, persisted plan before remove, unchanged charges,
scope/record mismatch before effects, busy reader contention, held native/metadata
originals, cancellation/close, sticky failed cleanup and failure notification.
Actual compiled-worker/native proof must process real committed intent/files,
recover a dropped plan/absence reply across reopen and preserve producer facts.
No public DELETE route, automatic retention selection, source cleanup, storage
refund, Docker/release or browser proof follows from this driver.
