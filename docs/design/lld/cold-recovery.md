# Cold archive and historical restore

Status: implementation under qualification. This is not a release certification.
[ADR016](../../decisions/016-historical-restore.md) owns the first-release decision.

## Supported operation

A maintenance process snapshots one stopped installation. It acquires the actual
backend and agent startup leases, verifies current schema/installation authority,
requires terminal and settled work, then checks the configured local Docker daemon
and stopped original containers. It never stops a service or repairs an old gate.
Unfinished delivery, charged work, pending publication/deletion and unknown state
refuse. No active-run snapshot or in-place rollback is supported.

The archive contains consistent normalized metadata/journal copies, installation
configuration and published input/output trees. It excludes serving gates, agent
credentials, mounted secrets and staging. Configurations and artifacts may themselves
contain sensitive test data; archives remain private. Metadata credentials are removed
from the copied database, with real SQL guards registered and freed pages compacted.
Source metadata and permanent mutation/deletion receipts remain unchanged.

## Bounds and custody

Canonical NDJSON records use strict relative paths, parent-before-child order,
unique entries, SHA-256 lengths/digests and an exact terminal count. The manifest is
at most32MiB, each line8KiB,100000 entries,8MiB aggregate path text and depth32.
Caller limits can be smaller. The byte limit covers logical archive payload,
manifest and a64KiB control allowance; restore reserves another8KiB for its claim.
It is not a filesystem-wide disk quota. SQLite normalization/compaction needs
additional temporary disk, bounded by the copied database size and its native
journal/work space. Insufficient space fails the operation; it never reports a
complete archive or refunds execution storage.

File I/O uses64KiB buffers, bounded partial writes and at most16 original resources
per maintenance operation. Discovery charges pending sibling names and paths before
recursion. Deadline/abort stops further work after an issued original settles.
An uncertain original close is sticky, retains its owner and fences new operations;
it is never retried or treated as successful cleanup.

The exclusive SQLite destination descriptor stays owned through backup,
normalization, fsync and actual closes. Held/named native identities are checked
synchronously immediately before both SQLite opens, then checked after the work.
This relies on the supported Node runtime opening the backup destination before
scheduling copy work; see [Node24.12 BackupJob](https://github.com/nodejs/node/blob/v24.12.0/src/node_sqlite.cc#L436).
The same ordering is present in [Node24.22.2](https://github.com/nodejs/node/blob/v24.22.2/src/node_sqlite.cc#L525), used by the local images. Changing the runtime requires checking this dependency. The boundary assumes private
same-UID directories; it does not sandbox a hostile operating-system owner.

All ordinary copy owners must drain before source leases release and a permanent
archive seal binds the manifest digest. Missing, partial or mismatched seals refuse.
Verification reads the whole manifest and every file, rejects unknown entries,
links and digest mismatches, and never accepts a complete prefix before actual EOF.

## Fresh historical destination

Restore exclusively creates a private destination and records a fresh historical
identity, exact operation ID, source backup/manifest identity, final path and native
root/work directory identities. An existing installation is never overwritten.
Resume requires that exact claim; foreign entries or another operation refuse.
A missing/corrupt claim or incomplete control initialization is not auto-adopted.

Copies use exclusively created operation-owned temporary files and no-overwrite
link publication. Resume can finish the exact interrupted link/copy, validate
already published bytes, and discard only recognized partial files in its claimed
work namespace. Data becomes0400, directories0500; the historical control remains
separate. A domain-separated native attestation binds the new root and actual
copied files. Original publication identities and journal authority stay archival.
After all originals drain, cancellation/deadline and root/work identity are checked
again before sealing. Historical purpose is immutable even before completion;
ordinary recovery completion cannot change it into serving readiness.

Completed resume verifies without changing data or resealing it. A historical root
must remain at its attested final path/native environment. To relocate it, restore
the portable archive into another fresh destination. No mutable-restoration toggle
or original-request replay is provided.

## Read-only viewer

The viewer checks the completed claim, manifest, exact layout, file hashes and
native attestation while retaining the historical control lease. The actual metadata
worker checks the expected native file before/after its read-only SQLite open and
retains that connection. It requires the exact supported schema and never migrates.
A default-deny worker allowlist and a pre-body HTTP mutation gate provide independent
write fences. Only browser authentication mutates fresh separate session storage;
each historical identity has its own cookie name.

No agent, capacity producer, delivery, input maintenance, retention, deletion or
history indexer runs. Input/artifact reads share two original jobs, one per file,
stream with consumer backpressure and recheck exact ancestors/files and closes.
Historical reads return bytes only: never live publication, ACK, execution,
settlement, deletion or refund authority. The UI identifies read-only history;
its broader redesign is separate work.
