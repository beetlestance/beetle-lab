# Private result publication

`publishK6Result(options)` verifies an existing k6 content seal and exact expected
scope using shared contracts, then publishes fixed `engine-result.json`. It returns
`result`, `quiesced` and cached `close`. Success includes the verified immutable
value, LF-inclusive bytes and raw-file SHA256, distinct from the content seal.
Invalid/mismatched seals or data never reach filesystem writes.

Caller reserves 1..1 MiB logical file bytes. Bounded JSON encoding includes LF;
depth 64/nodes 65536/collection4096 remain enforced. Writes are serialized, <=64 KiB
each and <=128 calls. One exclusive final pathname always has one inode/name;
directory metadata/physical blocks are outside the logical allowance. This owner
does not authorize reservations. Path appearance never grants completion authority.

Trusted root is canonical, nonsymlink, mode 0700, owned by the supplied current UID
and exclusively controlled against hostile same-UID replacement. Private stat/
lstat bigint device/inode comparisons preserve exact 64-bit IDs.
The final file is created O_EXCL/O_NOFOLLOW, mode 0600, regular/single-link. Bounded
writes, file fsync and its original close precede named identity/length checks.
Parent fsync, repeated identity checks and actual parent close precede success.
Existing targets/symlinks are never replaced. No hard link or rename is used.

A final filename can contain incomplete or even valid JSON before publication
succeeds. Runners emit result control evidence only after successful publication;
stopped collection requires that reported seal as well as the actual file. Fsync,
close or cancellation failure leaves charged unconfirmed output, never completion.

Absolute wall deadline plus independent <=60 s monotonic phase ceiling fence work;
clock rollback/throw, cancellation and close are sticky. Result may fail before
issued IO returns; quiesced/cached close await original operations and descriptor
closes, retaining original close failure. Final publication rechecks fences after
quiesced observers. Failure means publication unconfirmed: a bounded
final file may remain. Neither uncertain output nor final output is deleted after
cancellation, and no storage refund is claimed. Caller retains its reservation.
Filesystem ports are private fault-test seams, never staged/public options.
Content verification does not authenticate the producer, validate artifacts,
interpret outcomes or release capacity. Host FS exclusive-create/fsync semantics are required;
power-loss, Docker, architecture and release durability remain unqualified.

Checks: scoped Vitest `engines/k6/test/publication`, Node TypeScript and changed lint.
