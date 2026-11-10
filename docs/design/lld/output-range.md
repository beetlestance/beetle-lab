# Native declared output ranges

Status: frozen coordinator interface; implementation and independent acceptance
pending. Refines [output transfer](output-transfer.md). Root owns range-types.ts;
worker may add the exact readOutputRange entrypoint to collection/output/index.ts.
No new public request shape, digest format or historical artifact identity.

## Native port

readOutputRange: OutputRangeReader takes OutputRangeOptions and returns OutputRange.
Root is the exact private stored directory/uid/device/inode/mtime/ctime tuple;
artifact is one already selected stored declaration. Capture known option data
synchronously, reject accessors without executing them, and validate the artifact
through existing shared validatePrimitive('artifact'), not copied path grammar.
Offset is safe integer0..artifact.bytes; length1..65536. Deadline is fresh finite
performance.now time, bounded to OUTPUT_COLLECTION_MAX_MS; caller signal is a stop
hint. Root/path/descriptor numbers retain their original bigint/string precision.

A positive result contains exactly min(length,artifact.bytes-offset) bytes in an
owned Uint8Array, at most65536. Offset at EOF, including an empty artifact, returns
empty bytes only after actual root/ancestor/file open/check/close. It must not call
OutputFiles.read's nonzero-read path at EOF. File size must equal declared bytes.
No full artifact/result/control re-read or unrelated artifact hashing. Range bytes
are provisional; backend whole-file expected SHA256 is still mandatory.

## One custody implementation

Reuse OutputFiles and OutputIO for safe opens, ancestry, uid/modes/link/symlink,
per-operation inode/time checks and final named checks. Match the stored root tuple
before any file payload read and through final descriptor/named/close checks.
Do not implement a second file verifier. If option-root grammar needs sharing,
move its existing rules from output-source/shape.ts into collection/root's public
captureCollectionRootIdentity(input:unknown) entrypoint; delegate the old wrapper
and preserve its OutputSourceError invalid_input behavior and canonical preimages.
That helper consumes bounded owned/parsed data and establishes no native custody.

Original IO, handles, cached closes, deadline/signal observation and late-open
ownership must share one implementation with collection. Private lifecycle files
may be extracted with meaningful responsibilities; preserve existing collector
result/close/quiesced semantics. At most two native range originals; reserve before
option capture and retain until actual quiescence. This is a nested safety bound
on the transport's existing two source originals, not another connection pool or
queue. Collector's existing two originals remain independent: source download
saturation cannot turn a valid engine collection into busy/failed output.

Result may fail before cleanup settles; quiesced retains every original and the
range slot. Success requires all original closes and post-close named checks.
close is cached and its original descriptor-close failure is sticky. Abort/deadline
cannot discard a delayed open/read/close. Failed cleanup never reports success.
No collection source/Journal mutation, engine work, HTTP response, file deletion,
publication receipt or retention refund belongs to this native owner.

## Evidence

Native task-owned files: exact multi-range/short final bytes, zero and nonzero EOF,
size/root/file/ancestor replacement, symlink/hardlink/mode/uid changes, mutation
around reads and final close, safe-integer offsets, malformed paths/root/options.
Held original open/read/close after abort/deadline/close retains handles/slots and
prevents positive replies; original close failure stays rejected. Prove source
range saturation and pre-capture refusal independently of collector availability.
Run only affected existing collector cases after shared lifetime extraction; reuse
unchanged source/digest evidence unless a changed grammar requires selected vectors.
No native k6, HTTP/backend adoption or complete rewrite claim from range tests.
