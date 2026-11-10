# Stopped output verification

Public `collectOutputs` accepts a trusted stopped/launch-settled output directory,
expected owner UID, scope/engine, journaled result, accepted control-byte offset,
admitted output budget and monotonic deadline. It adds no lifecycle authority.

Two processwide slots are reserved before any caller descriptor/clock/signal work.
Own data fields and bounded JSON are captured synchronously; accessors reject.
Private ports support deterministic faults; production always uses Node FS/clock.

Contracts verify both reported and fixed engine-result.json seals. Scope, engine,
and full sealed identity must agree. Result actual bytes are capped at 1MiB.
Artifacts have unique case-normalized UUID IDs and paths; reserved root names,
case/path aliases and ancestor/descendant conflicts reject before file admission.

Canonical realpaths, 0700 directories/0600 regular single-link files, owner UID,
exact bigint identities and stable size/mtime/ctime are checked against named
paths and descriptors. Nested ancestors remain pinned while each file is read.
All previously observed paths receive a final metadata/canonical-path check,
then another owned named-path check after every original descriptor close settles.
The latter retains identity snapshots and never reopens or stats closed descriptors.
No directory scans, engine-specific interpretation or artifact-body history.

One artifact uses <=64KiB read windows. Only bounded metadata and the <=1MiB
result body are retained; artifact/path counts come from the shared schema.
Overflow-safe accounting covers actual result + declared artifacts + control
bytes. Undeclared occupancy and hard filesystem quota enforcement are separate.

Public cancellation/deadline/close may precede original IO completion. Quiescence
and cached close retain all original work and independent descriptor cleanup.
Failed closes are never retried or hidden. Slots remain held through cleanup;
success requires every original close and a final cancellation/deadline fence.

Focused checks: Vitest agent/test/output-collection --maxWorkers=2, Node TS,
scoped ESLint, architecture/docs/diff. Real temp files and private fault ports
exercise ownership; test-only Python os.mkfifo creates owned FIFO fixtures.

Successful collection also returns immutable private root identity and actual
result/control byte facts, bounded to32KiB. They appear only after original closes
and final named/fence checks; they are not a durable source/publication receipt.
