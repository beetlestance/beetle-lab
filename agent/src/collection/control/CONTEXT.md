# Incremental control intake

Public `createControlReader` accepts a trusted canonical absolute directory,
expected numeric owner UID, scoped generation, and optional durable checkpoint.
Construction snapshots validated options without IO. Production uses Node FS and
the monotonic performance clock; the private constructor/ports support fault tests.
Read reserves ownership before synchronously snapshotting budget data properties;
accessors are rejected without invocation. Clock/signal setup cannot displace it.

Reads own one original operation until `quiesced`; public cancellation/deadline
can settle first. Each pass issues <=8 reads and consumes <=256KiB actual bytes.
Retained input is one partial frame (<64KiB) plus one <=64KiB window. Exactly one
immutable <=100-event/256KiB normalized request may await journal acknowledgement.
Shared control-protocol copies own schema/scope/sequence/serialization admission.

Canonical realpath equality precedes admission and accompanies parent postchecks.
Directory/file custody checks enforce 0700/0600, expected owner, regular file,
single link, exact bigint identity, no-follow/nonblocking open, and no shrink.
Live missing files are provisional only without a checkpoint. Live incomplete
tails wait; stopped incomplete tails fail. No raw OS errors/content escape.

Restart rehashes the durable prefix over bounded passes before new intake.
Stopped verification rehashes the full committed prefix under stable metadata;
live reads remain explicitly provisional. Cached stopped proof rechecks custody
and metadata on every later read. These observations confer no release authority.

`accept` checks the sole pending cursor and adopts the journal-owned digest.
Wrong acknowledgements preserve pending state. Runtime IO/custody/corruption and
interrupted active IO fail the reader closed to further intake; construct another
reader from durable state to resume. Busy/invalid-budget calls affect no owner.
`close` caches one outcome, waits for all issued original IO, closes descriptors
independently, and permanently preserves any original close failure.

Focused checks: `vitest run agent/test/collection-control --maxWorkers=2`, Node TS,
and ESLint on this module and its tests. Tests use real task-owned temp files and
private fault seams; journal integration uses only its public entrypoint.
