# Recovery

Recovery is an offline maintenance path: a cold backup of one stopped installation
and a restore into a fresh, read-only historical destination. The backend recovery
control (`app/src/bootstrap/recovery-control`) excludes serving from maintenance;
the offline tools (`tools/recovery`) own backup, restore and the historical viewer;
the archive manifest format lives in `contracts/src/recovery`. Restore never replaces
a serving installation ([decision 016](../../decisions/016-historical-restore.md)).

## Recovery control

One private SQLite file per installation, created only by explicit offline
provisioning. Startup never creates, repairs or adopts a missing, corrupt, foreign
or non-ready control. Loader-configured production applications require it;
directly injected component fixtures may omit it.

| Property | Value |
| --- | --- |
| Size | ≤16 pages of 4096 bytes; 64 KiB cache; no mmap |
| Journal / sync | `DELETE` journaling, `synchronous=EXTRA`, `locking_mode=EXCLUSIVE` |
| File custody | No-follow open, canonical private parent, checked native identity, one hard link, fixed installation ID |
| Writes | Only phase transitions; no per-request, job or sample writes |

| Phase | Purpose | Entered by | Leaves to |
| --- | --- | --- | --- |
| `initializing` | `installation` | Offline provisioning | `ready` |
| `ready` | `installation` | Initialization or matching completion | `restoring` |
| `restoring` | either | Begin from `ready` with exact operation ID and manifest digest, or creation of a fresh history control | `ready` (installation, matching IDs) or `historical` (history, matching IDs plus attestation digest) |
| `historical` | `history` | Completion with attestation digest | never |

SQL CHECKs and triggers make `purpose` permanent and `historical` terminal; ordinary
completion refuses history purpose. Closing does not clear `restoring`. These
transitions are privileged primitives, not proof that a copy or restore succeeded.

Serving opens the control before metadata workers, input maintenance, capacity,
delivery or history indexing, and holds its exclusive lease until HTTP and input
readers, publishers, agent and runtime owners and metadata have all actually drained.
Abort alone does not release it; failed cleanup retains the handle and the exclusion.
It complements the agent installation-state lease. Tests:
`app/test/recovery/backend-control.test.ts`, `startup-control.test.ts`.

## Cold backup

| Precondition | Refusal |
| --- | --- |
| Both backend and agent startup leases acquired by the maintenance process | Lease held by a serving owner |
| Current schema and installation authority | Unknown or foreign schema |
| All work terminal and settled; no unfinished delivery, charged work, pending publication or deletion | Any unknown or active state |
| Configured local Docker daemon reachable; original containers stopped | Running or unknown container |

Backup never starts, stops or repairs services and never snapshots an active Run.

The archive contains normalised metadata and Journal copies, installation
configuration and published input and output trees. It excludes serving gates
(including recovery control), agent credentials, mounted secrets and staging.
Metadata credentials are removed from the copied database with SQL guards
registered and freed pages compacted. Source metadata and permanent receipts are
unchanged. Archives can contain sensitive test data and remain private.

## Archive format and limits

Manifest records are canonical NDJSON with strict relative lower-case paths,
parent-before-child order, unique entries, SHA-256 length and digest per file and an
exact terminal count. Limits are in `recoveryCaps` (`contracts/src/recovery/index.ts`)
and the tool bounds; callers may set smaller limits.

| Limit | Value |
| --- | --- |
| Manifest / line | 32 MiB / 8 KiB |
| Entries | 100 000 |
| Aggregate path text / depth | 8 MiB / 32 |
| Control allowance in byte budget | 64 KiB (restore adds 8 KiB for its claim) |
| File IO buffer | 64 KiB |
| Native originals per maintenance operation | 16 (`tools/recovery/src/io.ts`) |

The byte limit covers logical payload, manifest and control allowance; it is not a
filesystem quota. SQLite normalisation needs extra temporary disk up to the copied
database size plus journal space. Insufficient space fails the operation and never
reports a complete archive.

All copy owners drain before source leases are released and a permanent seal binds
the manifest digest. Missing, partial or mismatched seals refuse. Verification reads
the whole manifest and every file, rejects unknown entries, links and digest
mismatches, and never accepts a complete prefix before actual EOF.

## Fresh historical restore

- Restore exclusively creates a private destination and records a claim with a
  fresh historical identity, operation ID, source manifest identity, final path and
  native root and work-directory identities. An existing installation is never
  overwritten; the source archive is never modified.
- Resume requires that exact claim. Foreign entries, another operation, or a missing
  or corrupt claim refuse; nothing is auto-adopted.
- Copies use exclusively created, operation-owned temporary files and no-overwrite
  link publication. Resume may finish the interrupted copy, validate published bytes
  and discard only recognised partial files in its own work namespace.
- Published data becomes mode 0400 and directories 0500.
- A domain-separated native attestation binds the new root and the copied files;
  original publication identities and Journal authority stay archival only.
- Cancellation, deadline and root identity are rechecked after all originals drain
  and before sealing. Completed resume verifies without changing or resealing data.
- A historical root must stay at its attested path; relocating means restoring the
  archive again into another fresh destination.

## Read-only viewer

`tools/recovery/src/viewer` and `app/src/bootstrap/historical.ts` compose the viewer.

- It checks the completed claim, manifest, layout, file hashes and attestation while
  holding the historical control lease.
- Metadata opens read-only, requires the exact supported schema and never migrates;
  the expected native file is checked before and after the open.
- A default-deny worker allowlist and a pre-body HTTP mutation gate are independent
  write fences. Only browser sessions write, to a separate session table, with a
  cookie name per historical identity.
- No agent, capacity producer, delivery, input maintenance, retention, deletion or
  history indexer runs. Input and artifact reads share two jobs, one per file, with
  consumer backpressure and ancestor and file rechecks.
- Historical reads return bytes only; they never grant execution, ACK, settlement,
  deletion, refund or replay authority.
- `BrowserSession.restoredBackup` (`backupId`, `createdAt`) comes only from the
  verified manifest header (digest bound by claim and attestation), never from restore
  or open time. `createdAt` is the backup host's wall clock when the manifest header
  was written, after copying, normalised to UTC milliseconds; an unparsable value
  refuses the viewer. Serving sessions refuse the field.

## Failure handling

| Failure | Behaviour |
| --- | --- |
| Uncertain original close | Sticky; owner retained, new operations fenced; never retried or treated as cleaned |
| Deadline or abort | Stops further work only after the issued original settles |
| Interrupted restore | Destination keeps `restoring`; only the exact operation can resume |
| Identity substitution on the destination database | The descriptor is held through backup, normalisation, fsync and close; native identity is checked synchronously before both SQLite opens and after the work |

The database custody check relies on Node opening the backup destination before
scheduling copy work (Node 24.12 and the image's Node 24); changing the runtime
requires rechecking this (`tools/recovery/src/database-custody.ts`). The boundary
assumes private same-UID directories and does not sandbox a hostile host owner.

## Startup schema edits

Application migration 020 (`app/src/adapters/outbound/sqlite/migration020.ts`) adds
`clock_integrity` to the `runs.reason` CHECK without a table copy, because a durable
stop cause must never be remapped to satisfy an older constraint.

- Runs only inside the exclusive initialisation transaction with foreign keys on.
- Reads the `runs` CREATE statement capped at 16 KiB; requires the exact predecessor
  CHECK spelling once and no existing `clock_integrity`; compiles the revised
  statement in a separate in-memory database first.
- A synchronous window disables defensive mode, sets `writable_schema`, performs one
  compare-and-swap of `runs.sql` and bumps `schema_version`. Protections are always
  restored and verified by a denied no-op before further parsing or serving.
- Failure rolls back and closes the startup connection; schema 19 stays for retry.
  `user_version` 20 commits with the edit. Unknown reason values remain invalid.
- Schema 20 does not promise downgrade to an older image once new reasons persist.
  The downgrade helper exists only for synthetic tests and never touches user data.
- Serving connections always run with SQLite defensive mode on.

Test: `app/test/storage/clock-reason/migration.test.ts`.

## Related

- [Backup and restored history guide](../../../site/src/content/docs/guides/backup-and-restore.md)
- [Decision 016: historical restore](../../decisions/016-historical-restore.md)
- [Retirement](retirement.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/bootstrap/recovery-control/` | `11ff9036a2ef` |
| `contracts/src/recovery/` | `29c0467d1e7e` |
| `tools/recovery/src/restore.ts` | `c750dcfc2872` |
| `tools/recovery/src/backup.ts` | `9162094ddc58` |
| `tools/recovery/src/viewer/` | `d51c59cc6bf0` |
| `app/src/adapters/outbound/sqlite/migration020.ts` | `904e1235fc9a` |
