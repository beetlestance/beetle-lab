# Agent collection

Status: control intake implemented; final output verification contract frozen for implementation.
Scope: private single-agent local profile; public lifecycle remains in
[execution protocol](execution-protocol.md).

## Durable control intake (local profile)

`control.ndjson` contains UTF-8 `ControlEvent` frames with LF, at most64KiB per
frame, 65536 records and64MiB total. Agent enrichment has512 additional bytes;
public event batches remain at most100 records/256KiB including their envelope.
The agent reader must bound each pass to256KiB actual reads/eight read calls,
one frame/read window and one pending immutable batch. It must not rescan the
entire journal on every poll. Live torn tails wait; stopped torn tails fail.

A private wrapper checkpoint records exact bigint device/inode decimal strings,
committed byte offset, wrapper sequence and prefix SHA256. One SQLite transaction
CAS-commits a bounded event batch, projections, quota charges and checkpoint. The
journal computes its batch digest, so identical ambiguous replay remains safe after
pruning. Checkpoints stay charged; legacy append cannot bypass an adopted stream.
This is agent-internal state, not an engine SDK or browser endpoint.

Incremental live observations remain provisional: inode/size/timestamps cannot
prove an earlier prefix was unchanged during legitimate append. Restart must
verify the durable prefix over bounded passes; eligible stopped collection must
rehash the full accepted prefix under stable file identity/metadata. A mismatch
invalidates collection without rewriting durable observation history. These
checkpoints do not authorize capacity release or application finalization.

## Final output verification

Final output verification is agent-owned and engine-independent. Its trusted
caller first establishes stopped runtime, settled launch and `stopped_verified`
control intake. The collector verifies fixed `engine-result.json` (at most1MiB)
against its content seal, scoped generation, installed engine and journaled result;
it then streams every declared artifact through at most64KiB read windows. Artifact
IDs/paths are unique; reserved result/control names and aliases reject. Canonical
root/ancestors, owner, modes, single-link files and stable named/descriptor identity
are checked before and after reads. Hash and length must match each declaration.
Result bytes, declared artifact bytes and accepted control bytes together must fit
the admitted output budget. No directory/history scan or artifact-body retention
is needed. This does not prove an absence of undeclared files or enforce a hard
filesystem quota; the execution output guard owns that separate responsibility.

Collection uses the remaining attempt deadline (one call at most five minutes),
at most two active operations per agent process, and no hidden retry. Cancellation
may return before original IO settles; quiescence and cached close retain every
issued original and close failure. Reserve an active slot before external validation
callbacks and retain it until all originals and descriptor closes settle. Success
requires every original close to succeed and a final cancellation/deadline fence.
Success establishes content/custody observations,
not authentication, application finalization or reservation release. The controller
must retain charges until originals settle and it records later stopped/collection
evidence; application acknowledgement remains separately required before deletion.

