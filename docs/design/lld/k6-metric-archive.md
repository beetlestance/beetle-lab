# Retained k6 metric windows

Status: accepted engine implementation contract. This batch supplies sealed metric
history; public sample reads/live transport/charts remain subsequent consumers.
[Distributions](k6-distributions.md) owns numeric semantics; the
[execution protocol](execution-protocol.md) reserves stdout/control for lifecycle.

## Representation and ownership

The staged wrapper's serial MetricWindow callback writes two fixed engine-owned
files: metric-windows.ndjson and metric-index.ndjson. No metric corpus is retained
in memory or appended to the lifecycle journal. Existing optional onWindow remains
serial and runs after the archive append; it does not own archival integrity.
Only approved numeric series/labels from the existing accumulator enter history.
Readiness exclusion, source-second windows, late-point policy, histogram units and
final native threshold verdicts remain unchanged. Unoccupied source intervals are
not invented zero observations. Numeric-final retains final totals and coverage.

Each file begins with a version1 header binding organisation/workspace/attempt/
generation and the data artifact UUID. Each data record contains sequence1..65536
and the existing MetricWindow. Complete UTF8 records including newline are <=1MiB.
Require increasing nonoverlapping one-second source intervals; gaps are allowed and
remain visible. The index has one bounded <=256-byte record per data window with
sequence, start/end time, byte offset and complete record length. Offsets include
the header and are safe integers. The data footer binds record count. The index footer binds count, complete data
file bytes and SHA256 (including the data footer, excluding no data bytes). Index record lengths describe data ranges; they never select a filesystem
path. Consumers must bind the pair through published artifact IDs and source scope.

Serialize one window at a time, append data/index through <=64KiB writes, and keep
only current offsets/count/hash states and at most one encoded record. No retained
array of records/index offsets, whole-file reread, JSON final array or unbounded
final serializer. No waiting queue; concurrent append/seal refuses as busy.
Original writes remain owned through abort and shutdown. Crash prefixes are not
sealed evidence; only final custody and manifest publication authorize reads.

## Reservations and phase facts

Carve an explicit history allowance from existing admitted output, without raising
any user budget or installed ceiling. Preserve control/numeric/result reservations.
Use at most min(256MiB, floor(availableExecutionBytes/4)) for data+index combined;
reduce maximum build bytes accordingly. Require at least64KiB history room and the
existing build/native-summary floor, otherwise fail output_limit before native load.
Also bound history by execute phase produced-output allowance minus the existing
1MiB native-summary producer reserve. Insufficient phase allowance refuses before
execution; no silent history disablement or discarded windows to obtain success.

Every frame/header/index/footer byte is charged before its write, including partial
writes and final records. A frame, count, arithmetic or combined allowance excess
is explicit output_limit/measurement failure; it cannot become complete history.
Retained build + native summary + history + control + numeric + result never exceeds
the Offer ceiling. Reserve bounded footer space before accepting records. Finalization cannot borrow
an unbounded temporary allowance.
Existing collect allowance still governs newly produced summary/numeric evidence;
retained execute history is not charged twice as newly produced collect output.
Report history bytes as execute-phase work, including final drained windows at the
actual transition boundary. Preserve exact output accounting and useful progress.

## Seal and cleanup

Create files exclusively/no-follow under the verified output root, mode0600,
expected UID, one link. Retain root/file descriptors before subsequent checks.
Share existing artifact identity rules where their meaning matches; do not clone a
second independent filesystem custody policy. After all callback originals settle,
write final bounded records, sync, verify hashes by streaming <=64KiB reads through
exact EOF with pinned root/file identity before/after, close, then recheck named
identity. Seal only after original close succeeds. No whole-file allocation.

Return two ordinary sealed artifact descriptors, kinds metric-windows and
metric-index, with fixed relative names and matching UUID/header bindings.
Numeric-final advances its private version and truthfully records retained history
pair/count/bytes; final totals remain independent of window gaps. EngineResult seal
covers these descriptors through existing publication; no new result authority,
writer claim, ACK, app/agent migration or path-based content endpoint is introduced.

Cancellation/failure closes and drains owned descriptors, including ignored/late
writes and close failures. Cleanup failure stays failure; no speculative deletion
of uncertain retained files. Partial history cannot receive a sealed descriptor or
windowsRetained:true. Update artifact quiescence with the same original ownership.

## Acceptance

Use the actual accumulator -> staged attempt -> files -> result seal composition,
including multiple windows, gaps, histogram preservation, known numerical oracles,
header/index/data hash binding, non-ASCII byte offsets, empty history, quota/frame/
count limits, partial writes, truncation/alteration, symlink/root replacement,
held writes/close, cancellation and final drain. Large history must exceed parser
buffer size while memory remains independent of total history length. Measure
explicit buffers and finalization, without claiming a whole-process RSS guarantee.

Scoped archive/attempt/execution controls, changed lint and Node types; no full
suite/image rebuild. Coordinator reviews the changed composition once. Real k6
throughput/fsync overhead, runtime resource qualification, live prefix reads,
backend downsampling and browser charts remain distinct acceptance work.
