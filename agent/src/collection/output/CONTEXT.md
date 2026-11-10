# Stopped output verification

Public `collectOutputs` accepts a trusted stopped/launch-settled output directory,
expected owner UID, scope/engine, journaled result, accepted control-byte offset,
admitted output budget and monotonic deadline. It adds no lifecycle authority.

Two processwide slots are reserved before any caller descriptor/clock/signal work.
Own data fields and bounded JSON are captured synchronously; accessors reject.
Private ports support deterministic faults; production always uses Node FS/clock.

Contracts verify both reported and fixed engine-result.json seals and scope/engine.
Full sealed identity must agree. Result actual bytes are capped at 1MiB.
Artifacts have unique case-normalized UUID IDs and paths; reserved root names,
case/path aliases and ancestor/descendant conflicts reject before file admission.

Canonical realpaths, 0700 directories/0600 regular single-link files, owner UID,
exact bigint identities and stable size/mtime/ctime are checked against named
paths and descriptors. Nested ancestors remain pinned while each file is read.
All previously observed paths receive a final metadata/canonical-path check,
then another owned named-path check after every original descriptor close settles.
The latter retains identity snapshots and never reopens or stats closed descriptors.
One artifact uses <=64KiB read windows. Only bounded metadata and the <=1MiB
result body are retained; artifact/path counts come from the shared schema.
Overflow-safe accounting covers actual result + declared artifacts + control bytes.

Public cancellation/deadline/close may precede original IO completion. Quiescence
and cached close retain all original work and independent descriptor cleanup.
Failed closes are never retried or hidden. Slots remain held through cleanup;
success requires every original close and a final cancellation/deadline fence.

Focused checks: Vitest agent/test/output-collection and output-range --maxWorkers=1,
Node TS and scoped ESLint. Real temp files and private fault ports exercise custody.
Successful collection also returns shared immutable private root identity and actual
result/control byte facts, bounded to32KiB, after original closes and final checks.
`readOutputRange` captures one stored root and declared artifact, with a fresh
bounded deadline and safe offset/length. Its independent two slots remain reserved
through original quiescence. It shares OutputLifetime and OutputFiles custody with
collection, pins the stored root before payload IO and returns <=65536 owned bytes.
EOF still opens/checks/closes; success follows closes and final named checks.
Chunks remain provisional until the backend verifies the whole artifact SHA256.
