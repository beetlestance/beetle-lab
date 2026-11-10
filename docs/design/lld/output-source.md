# Verified output source

Status: proposal under independent review; no new wire schema, journal migration
or implementation is accepted by this page. Scope: durable agent source authority
for later backend transfer. Application publication and terminal results remain
separate contracts under [output allocation](output-allocation.md).
The [source commit contract](output-source-commit.md) freezes reviewed private values,
digest vectors, journal quota and finished-release gating; implementation is pending.

## Ownership and existing evidence

The output collector already verifies the stopped control prefix, content-sealed
result and declared artifacts under the original output budget. Its successful
result is process-owned. Durable reservation release records collection state and
an evidence ID, but does not retain a transferable manifest or filesystem custody.
Neither snapshot.result, collection.finished nor an event ACK is a publication
receipt. Reuse contracts.verifyEngineResultSeal and the existing collector/files
owner; do not implement another result mapper or path verifier.

A new private journal source owner retains one immutable verified manifest per
original generation1 attempt. Only the trusted controller can submit a collected
observation; no HTTP route accepts it. The journal validates identity and durable
launch/control facts, not a caller's claim that JSON proves filesystem integrity.
The collector remains responsible for actual hashing, file custody and closes.

## Manifest creation

Required facts before creating source authority:

- Exact physical journal UUID, organisation/workspace/attempt/intent/generation,
  installed engine identity and prepared runtime specDigest match the original.
- Launch is settled and runtime is known stopped. The accepted control checkpoint
  is stopped_verified; its bytes/sequence and journaled engine.result agree.
- Result content seal is verified, including scope, engine and manifest identities.
  All declared artifacts were hashed and sized by the existing collector, and
  result/control/artifact bytes fit the immutable Offer output budget.
- Every original collector read and descriptor close has quiesced successfully;
  no output writer remains. A timed-out wrapper promise cannot provide this fact.

Capture these facts before any foreign await. Commit an immutable source row before
recording successful physical release. A lost commit reply is reconciled by exact
source digest; no second collection or target execution is inferred necessary.
A same-identity/different-content replay fails closed. Failed collection has no
verified source manifest; retain diagnostics and later nonexecution/error closure.

Persist the canonical verified EngineResult, result-file byte count, accepted
control byte count, verified total, original binding, collection evidence identity,
private output-root/uid/root identity and source-version1. Artifact IDs, paths,
lengths and hashes come from that result; do not duplicate another manifest list.
The source digest covers a versioned canonical preimage of these immutable facts;
public manifest identity excludes private host paths and file descriptors.
The exact preimage and field schemas must freeze with conformance vectors before
code. Source identity is content/custody identity, not a test verdict.

[Collected output facts](output-collection-custody.md) preserve raw result-file
length and root custody as a first producer step. A valid raw result file may be
1MiB because whitespace is not covered by the canonical content seal. Later
source delivery persists canonical verified result content, not raw result bytes.
The actual control/journal producer bounds canonical result payload by its65536-byte
frame; this does not shrink the collector's existing raw-file limit. A public source envelope
including the result is at most73728 bytes; the private persisted source record is
at most131072 bytes. Preserve the existing128-artifact result bound. Recheck byte,
depth and node limits independently before canonicalization or RPC serialization.
Private metadata and the duplicated retained result need an explicit bounded
journal charge before commit; quota failure cannot release source custody. Freeze
that charge against the existing journal quota owner before reserving migration IDs.

## Restart, root custody and reads

The persisted private root is derived from the original prepared plan, never an
HTTP path. Recover the same installed profile/specDigest and a configured trusted
staging root before opening it. Missing old profiles/roots make transfer unavailable;
current catalogue values cannot replace old authority. Keep required profile/root
bindings until their retained sources close. No directory/history scan is required.

Reopen the expected canonical root with its stored exact device/inode identity,
owner and modes. Restored or replaced files do not inherit authority merely from
matching names. Reuse the file owner to reject symlinks, multiple links, reserved
paths, path aliases, duplicate artifact IDs and ancestor/descriptor changes.
Do not follow caller paths, redirects or a replacement journal UUID.

Later transport selects only the fixed result identity or an artifact ID declared
by this source. Each range opens a freshly checked descriptor, validates declared
size, reads at most65536 bytes, rechecks named/descriptor custody and closes it.
Range bytes are provisional until the backend verifies the complete declared hash;
a manifest digest or ETag does not prove each returned chunk's content. Backend
publication requires complete size/hash verification even after resumed ranges.
File mutation or identity failure preserves the original source and returns an
explicit failure; no replacement content is adopted under the same manifest.
Zero-byte files still require valid custody, declared hash and explicit EOF proof.

No source-file deletion may overlap an issued range read or unresolved original
close. Cancellation is a stop hint; source leases/credits remain owned until native
work and closes settle. Reuse shared private HTTP/gateway bounds, with a separately
bounded byte window rather than an unbounded stream or new request pool. Wire
schemas, ranges, errors, original-call credits and source leases freeze together
before transport implementation; this page does not invent accepted endpoints.

## Accounting and acknowledgement

Agent source retention, backend payload reservation and execution resources are
separate. Physical CPU/RAM release does not release backend output allowance or
permission to delete source files. Event ACK only permits control replay pruning.
No source deletion or allocation settlement API is introduced by this first step.

Backend adoption must count retained enriched event bytes/row allowance, result
payload, artifact bytes and simultaneous staging/report copies in the existing
output allowance. Native control-file bytes alone cannot predict backend retained
control cost. Freeze this arithmetic and insufficient-headroom behavior before
adoption; never silently borrow metadata allowance, expand limits or double charge.
A valid native result can still be unpublishable when retained-output headroom is
insufficient; report storage/closure failure rather than pass or rerun targets.

Later application publication acknowledgement must match this exact source and
verified durable backend closure. Agent deletion requires durable acknowledgement,
retention/delete intent and quiescent source readers. Backend settlement requires
its own writer/transfer quiescence, manifest closure and published retained bytes;
only then may unused allowance be released. Missing files or generic404 prove
neither absence nor completed transfer. Refused/unstarted attempts need separate
nonexecution closure and cannot fabricate an EngineResult/source manifest.

## Required decisions before source commit

The independent opinion requires exact collected-checkpoint/launch/runtime fact
schemas; stopped_verified is currently process-owned, not a persisted checkpoint
flag. Bind the trusted observation without claiming JSON proves quiescence.
Freeze separate public manifest/private custody digest preimages and stable replay
identity, then require a matching source receipt for new finished releases. Existing
released attempts remain source-unavailable; never backfill from a snapshot.

Specify source commit/read ambiguity and shutdown custody without downgrading a
failed source commit into successful physical release. Add source record bytes to
all existing per-attempt journal quota equations, and separately bound retained
output files after execution release. Current admission excludes released resource
reservations, so metadata charging alone does not provide retained-file capacity.
Source recovery must read retained authority without execution restaging. These
journal/retention/release amendments are not implemented by collected facts.

## Implementation order and acceptance

1. Freeze exact source fact types/preimage, journal quota and migration guards.
2. Extend collector success custody and controller/journal commit without changing
   existing result validation or successful release semantics prematurely.
3. Prove real stopped collection -> durable source -> close/reopen and exact replay.
4. Freeze bounded transport and backend adoption contracts, then terminal closure.

Required failure oracles: wrong UUID/scope/intent/profile/specDigest, provisional
snapshot without stopped collection, outstanding read/close, failed COMMIT, lost
reply, conflicting replay, lowered quota, corrupt/private/public envelope bounds,
result or artifact mutation, root replacement/cold restore, catalogue drift,
zero-byte artifact, cancellation during final commit and release racing creation.
Check durable rows/counters and real files independently of returned success.
No source receipt alone qualifies an engine outcome, backend publication or R0–R4.
