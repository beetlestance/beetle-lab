# Collection directory facts

Shared private value type and formatting for the existing control/output file
owners. snapshotRootIdentity accepts an already checked directory/uid/native stat;
it does no filesystem IO, path resolution, validation or ownership transfer.
Callers retain all original custody, modes, post-close and quiescence checks.

Never Number-convert native device/inode/nanosecond values. The returned scalar
snapshot is frozen. A snapshot is not a durable source receipt or release proof.
Producer contract: docs/design/lld/output-collection-intent.md.

captureCollectionRootIdentity owns the existing stored-root scalar grammar. It
copies exact own data properties without accessors and freezes the bounded tuple;
it establishes no native custody. The output-source wrapper retains its public
invalid_input error mapping and unchanged canonical source preimages.
