# Application output transfer owner

Status: coordinator implementation contract. Consumes accepted [writer metadata](output-artifact-writer.md),
[source transport](output-transfer.md) and [native byte storage](output-files.md).
No engine offer, automatic target retry, terminal run, refund or deletion occurs.

## Ownership and bounds

One parent service per injected byte-store instance owns at most two run transfers,
one per exact captured EventBinding. Reserve before foreign capture/callbacks; pass
the reserved job directly, never look it up again from mutable caller input. Capture
complete fixed identities before deriving the key. Refuse busy without a queue.
Each run handles at most128 artifacts serially, so source/native windows remain2.
Retain only active bounded source/state/chunk values, no growing history or timers.

Each job owns an internal abort controller and every issued gateway/metadata/file
promise. Await file result AND settled before using any positive receipt. An error
may reject the result earlier while unknown settlement stays pending and owned.
A failed original close keeps settlement and job/token credit pending, fences the
service, and makes cached service close reject cleanup while retaining ownership.
Caller cancellation requests stop; it never drops an original or proves quiescence.
Fresh native deadlines<=300000ms are independent of execution time. Validate reserve,
clock and UUID-generator values; invalid or backwards time fails closed.

Service close synchronously fences producers, aborts jobs and drains its actual
originals. It does not close shared gateway, metadata or byte store. Composition
must drain service, gateway and metadata before releasing the byte-store namespace
lease. Metadata-worker unknown outcomes stay charged and are reconciled after the
old worker lifecycle drains; promise rejection alone is no replacement proof.

## Flow

1. Load the exact retained source state. If pending, request source on the same
   installation gateway and adopt its validated immutable envelope. Only the exact
   source_pending protocol response returns pending. Other errors remain explicit.
2. Read the adopted source locally, match original digests and derive artifact keys.
   Never use a current catalogue/profile or fetch an arbitrary engine-relative path.
3. Read/reuse a non-NULL stored logical writer under the real namespace owner; else
   claim a fresh canonical UUID with exact slot version. Do not steal another writer.
   Refresh from durable state after an unknown metadata outcome on the next transfer;
   do not blindly repeat a mutation or create a replacement token/file.
4. For transferring state, native prepare reconciles the existing file. Record its
   checked stable identity/extent. Fetch chunks using exact source/manifest/artifact
   selectors and declared size, decode only bounded canonical bytes through shared
   validation, append to that original and record versioned progress. No inline
   network/SQL retry loop and no metadata/FS work inside one another's transaction.
5. At full extent, begin publication in metadata. Synchronously fence that artifact's
   producer against further chunk work, publish through native files, await result
   and settled, then record the exact native publication receipt. After cancellation/
   close, issue no new operation; already-issued originals still drain.
6. Recover publishing state by calling native publish directly, which proves its
   deterministic aliases/full hash. Recover published state by native read-only
   prepare/identity verification, never another write or silent identity replacement.
7. Return published only when every declared artifact has durable published metadata,
   no writer, matching native identity and all this job's originals are quiescent.
   Empty artifact lists still require a valid adopted envelope; zero-byte artifacts
   require actual native prepare/publication. This outcome grants no terminal state.

Keep complete source/closure identity immutable across the flow. Metadata methods
alone do not prove file custody; native positive receipts alone do not prove durable
progress. Partial append, publication or reply loss leaves existing charged tokens
and can recover without reexecuting target load. Original failures expose fixed
safe error codes without paths, raw data or guessed success.

## Focused evidence

Fake controlled ports for held source/metadata/file originals, producer cutoff,
reentrant capture/cancel/close, capacity and sticky cleanup; exact outcome/error
classification, no dependency close, no engine execution calls. Real compiled
MetadataWorker + native byte adapter + same-connection Node HTTP gateway against
one bounded synthetic source peer: independent multi-range bytes/SHA, empty file,
zero-artifact source, interrupted progress/publication/reopen, same tokens and
published reads. This peer seam is not real agent/k6 qualification. Reuse existing
actual agent Journal/native HTTP evidence; final real-engine/UI slice remains
required after this service is wired into startup and bounded polling.
