# Private result publication

`publishK6Result(options)` verifies an existing k6 content seal and exact expected
scope using shared contracts, then publishes fixed `engine-result.json`. It returns
`result`, `quiesced` and cached `close`. Success includes the verified immutable
value, LF-inclusive bytes and raw-file SHA256, distinct from the content seal.
Invalid/mismatched seals or data never reach filesystem writes.

Caller reserves 1..1MiB logical file bytes. Bounded JSON encoding includes LF;
depth64/nodes65536/collection4096 remain enforced. Writes are serialized, <=64KiB
each and <=128 calls. File data uses one inode; hard-link publication briefly adds
a second name, never a second data copy. Directory metadata/physical disk blocks
are outside this logical allowance. This owner does not authorize reservations.

Trusted root is canonical, nonsymlink, mode0700, owned by the supplied current UID
and exclusively controlled against hostile same-UID replacement. Numeric device/
inode identities must be safe integers. Fresh random pending file is mode0600,
regular/single-link. File size/identity/owner/permissions and parent descriptor/
name identity are checked. File fsync and original close precede exclusive link;
pending unlink, final single-link checks, parent fsync and original close precede
success. Existing targets/symlinks are never replaced. No weaker FS fallback runs.

Absolute wall deadline plus independent <=60s monotonic phase ceiling fence work;
clock rollback/throw, cancellation and close are sticky. Result may fail before
issued IO returns; quiesced/cached close await original operations and descriptor
closes, retaining original close failure. Final publication rechecks fences after
quiesced observers. Failure means publication unconfirmed: a bounded pending or
final file may remain. Neither uncertain output nor final output is deleted after
cancellation, and no storage refund is claimed. Caller retains its reservation.

Filesystem ports are private fault-test seams, never staged/public options.
Content verification does not authenticate the producer, validate artifacts,
interpret outcomes or release capacity. Host FS link/fsync semantics are required;
power-loss, Docker, architecture and release durability remain unqualified.

Checks: scoped Vitest `engines/k6/test/publication`, Node TypeScript and changed lint.
