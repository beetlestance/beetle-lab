# Artifact writer and progress metadata

Status: implemented and reviewed locally with application migration010.
Extends [source adoption](output-adoption-store.md) and [native bytes](output-files.md).
No terminal projection, quota refund, deletion or network/file IO occurs in SQL.

## Original ownership

OutputArtifactStore extends the existing private metadata facade. Keys bind the
retained EventBinding, exact adopted manifest/source digests and ordinal0..127.
Resolve immutable artifact ID/length/SHA from the one manifest, never caller copies.
Requests/replies<=4096 bytes on both RPC sides; methods share the existing worker
queue, not a new pool. Metadata.outputs exposes the extended interface; base methods
and their large-original credits remain unchanged.

The application transfer owner holds the actual native namespace lease and one
logical producer per artifact before claiming. A durable UUID writer identifies
that same logical transfer across retries/restarts, not a PID or a lease timeout.
Recovery under the exclusive native owner reads/reuses the existing writer; it
never steals or replaces a non-NULL different writer using CAS or elapsed time.
Retain all source HTTP/file originals and cached closes before retiring a producer.

## Transitions

| Method | Preconditions | Atomic result |
| --- | --- | --- |
| claimArtifact | Exact key/version, transferring, writer NULL | Set caller's canonical UUID writer, increment slot version |
| recordProgress | Same writer, transferring, transferring native receipt | Store matching token/stable identity and monotonic offset<=expected bytes, increment version |
| beginPublication | Same writer, full expected offset, non-NULL staging identity | Change transferring to publishing, retaining token/identity/writer |
| recordPublication | Same writer, publishing, published native receipt/full offset | Store published identity, phase published and writer NULL |

Every changing write requires exact expected slot version and advances by one
safe integer. Initial prepare can introduce the first staging identity. Subsequent
progress must retain it. Only publication upgrades to a full published identity.
Equal claim/begin/progress/publication replay returns current state without a new
write/version; different or stale incompatible evidence conflicts. Older matching
progress may return a newer monotonic offset under the same writer/identity rather
than rewinding. A published claim returns its existing read-only record, never a
new writer. Publication replay matches token/full offset/published identity after
writer clearing, without needing another persisted receipt copy.

Producer fencing is actual application ownership: no late source callback may
start a new write after publication begins. The owner awaits native result and
settled originals before recording publication. SQL receives the exact checked
native receipt, not a caller boolean. Full expected SHA, native file/directory
flushes and successful cached closes remain byte-adapter responsibilities.

## Native constraints and reads

Replace only migration009's deliberately immutable slot UPDATE trigger. Keep
initial insertion strict v1/o0/transferring/i=NULL/w=NULL, token uniqueness, source
immutability, retained rows, event ceiling and all payload allowance guards.
Validate the closed bounded duplicate-free slot tree before JSON path extraction;
all versions/offsets are typed safe integers, UUIDs/digests have exact grammars.
Never change attempt/ordinal/token. Published state is immutable; non-NULL writer
may only remain itself or clear in the publishing-to-published transition. Reject
phase regression, incomplete publication, offset reduction, identity replacement
outside publication, version-only advances, unsafe arithmetic and delete/REPLACE.
Expected size comes from the sole manifest. Native guards enforce these transitions
as well as the application preflight. No new byte/counter reservation is created.

Source parent's version remains its immutable adoption version1. Slot versions
carry progress independently. Broaden the existing shared slot decoder to the
already-declared phase/identity/writer vocabulary; do not create another decoder.
Base load/equal adoption replay must keep returning the current derived slots.
CASE-bound text before materialization, validate replies against original keys,
and preserve source-envelope/result chronology semantics.

## Focused evidence

Actual SQLite and compiled MetadataWorker: claim/claim collision, exact and stale
CAS, progress equality/overlap/highest offset, lost committed response/reopen under
the same writer/token, empty artifact, begin/publication and replay after writer
clears; cross-scope/source/ordinal and all native illegal transitions unchanged-
state/FK checks. Include one actual byte-adapter+metadata composition from prepare
through chunk progress and publication; a row-only fake receipt is insufficient
for that seam. Invalid receipt cannot mark publication or refund anything.
Native namespace lease/producer quiescence remain separate actual originals; this
metadata slice alone cannot establish complete transfer or a terminal result.
