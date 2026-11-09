# Input byte publication

Status: metadata/migration003 implemented and independently reviewed; see
[storage intake evidence](../../verification/storage-intake.md). Byte publication,
transfer and UI remain; no upload availability is claimed.
Owners: application input service, sole metadata worker, local byte adapter.
The [installed provider](installed-providers.md) owns agent reads; the
[suite contract](suite-authoring.md) owns immutable configuration references.

## Identity and transport

Every operation binds organisation/workspace/input UUIDs, normalized lowercase.
An input has immutable expected SHA256 and bytes (0..8MiB), an opaque server ID,
name and same-workspace folder (omission chooses the actual root folder).
Names use namespace normalization; a display name never becomes a file path.
Public records contain identity, scope, name, folderId, expected hash/bytes,
committed offset, version, state and a fixed safe failure reason or null.
No local path, resolved secret or uploaded content appears in metadata replies.

Workspace routes are `/api/v2/organizations/{organizationId}/workspaces/{workspaceId}`
plus `/inputs`: POST create, GET paged index; GET `/{inputId}` status;
PUT `/{inputId}/chunks?offset=N`; POST `/{inputId}/seal`; DELETE `/{inputId}`;
GET `/{inputId}/content` for a published input. All use the existing local
session/origin/CSRF guards, including binary mutations before body consumption.
Generated schemas/client own JSON control and acknowledgement DTOs. A narrow byte
route/client owns octet-stream chunks and content; do not generalize the JSON
operation adapter into a transfer framework. Scope/path equality is mandatory.

Create includes requestId, scope, name, optional folderId, expected hash/bytes.
Seal/delete include requestId, scope and expectedVersion. Shared receipt lookup
precedes current-state/version checks; changed intent conflicts across operation
kinds. Create returns201 and the original staging record. Seal/delete return202
acceptance receipts, never proof of publication or released storage; status is
authoritative. Replay preserves identity/receipt and cannot recreate deleted bytes.
Committed offsets and lifecycle transitions increment version; unchanged replay
does not. Pages are <=100, indexed and query/scope-bound like suite pages.
Each input owns at most one create, seal and deletion intent/receipt. A new key
cannot mint another receipt for an existing seal/delete intent; retry its original
identity. Failed cleanup keeps that deletion intent, bounding retained metadata.
Seal consumes its sole intent only from staging with offset==bytes. Delete may
begin from staging/publishing/published/failed; deleted/deleting reject a new key.

## One durable lifecycle

| State | Allowed progress | Byte authority |
| --- | --- | --- |
| staging | Append; begin publishing; begin deletion | Only committed prefix |
| publishing | Verify/promote; commit published; begin deletion | No revision pin yet |
| published | Read/pin; begin deletion when unpinned | Verified publication evidence |
| deleting | Durable cleanup; commit deleted | Fenced from new pins/reads |
| deleted | Retained tombstone only | Durable absence established |
| failed | Explicit deletion | Unknown custody remains charged |

The row itself is the create intent. For offset0 staging, recovery may create the
missing exclusive staging file; never recreate a missing committed prefix.
Before promotion persist publishing intent. File operations occur outside SQLite
transactions. Publication metadata commits only after exact size/hash verification,
file flush, no-overwrite promotion and both source/destination parent flushes.
Persist newly created ancestor directories before acknowledging durable custody.
Successful reads/pins do not certify against later changes by the local admin;
provider/Stager recheck real byte identity and integrity before execution.

Chunk length is1..64KiB, except no chunks are required for an empty input. Acquire
capacity before consuming a body. Append starts exactly at committed offset and
cannot exceed expected size. Earlier retries must lie wholly inside the committed
prefix and compare identical bytes; gaps, changed bytes and partial overlaps fail.
Flush before advancing persisted offset. Store no per-chunk receipts/hashes.
Crash with excess file bytes: truncate to committed offset and flush before append.
Shorter/mismatched custody fails closed; offset never advances from client claims.

Create is metadata-only, including receipt replay; it never creates or repairs files.
Append or staging recovery may create missing offset0 custody. Seal/delete acquire
canonical route-key ownership before control, without preceding state/version checks.
After known acceptance, re-get the current row before optional inline reconciliation;
return the original receipt even when work remains pending. An old seal replay cannot
republish deleting/deleted/failed bytes. No receipt-lookup projection is required.

Publishing recovery checks deterministic staging and destination identities.
A valid destination may finish publication; valid staging may finish promotion.
Missing, mismatched or ambiguous ownership remains fenced/charged and reports
unavailable or failed; never overwrite an unexpected destination. No append after
publishing intent. Deleted/published files are never synthesized from metadata.
The sole reconstructible exception is publishing with bytes=offset=0 and SHA256(empty):
after proving BOTH names absent and private parent ownership, exclusively materialize
and flush empty staging, then use ordinary publication. Never reconstruct a nonempty
committed prefix or a published/deleted file; a wrong empty digest is integrity failure.

Delete intent atomically requires no retained revision pins and prevents new pins.
Remove owned staging/published remnants, flush unlink parents, then commit deleted
and release payload charge. Failed/unknown cleanup retains its charge. Retained
tombstones/receipts remain charged and replay cannot resurrect their input identity.
Manual retention is the initial default; abandoned uploads require explicit delete.
Bounded paged recovery runs through the same service and operation limits.
Cleanup failures preserve deleting and its original intent, with a safe reason;
recovery can finish without accepting another delete key. Never strand cleanup in
failed. Progress requires staging and a strictly increasing offset<=bytes; publish
requires publishing/offset==bytes; absence commit requires deleting. All advances
compare exact version. Failure fences staging/publishing/published as failed;
deleting retains its state, deleted rejects changes. No failed->staging/published.

## Quota, metadata and file ownership

The sole SQLite worker reserves expected payload bytes plus64KiB metadata charge
per input in one installation usage counter: charged+payload+metadata+configured
freeSpaceReserveBytes<=pool.storageBytes, using checked safe integer arithmetic.
The fixed charge bounds zero-byte objects, directories, lifecycle rows and control
receipts; no unbounded chunk history. Retain that charge with the tombstone.
Future output/artifact owners consume this same counter, not another full allowance.
Reservations use safe integer arithmetic. Settings reductions may leave installation
usage over budget; preserve existing charges, block new allocations and never purge
or revoke admitted custody silently. Physical free-space reserve checks supplement
logical accounting before writes; ENOSPC is an explicit failure, never publication.
No claim of a hard filesystem quota follows from a logical counter/statfs sample.

Migration003 extends/rebuilds input_blobs as the single lifecycle owner, with
offset/version/expectation checks, scoped workspace/folder FKs and recovery/list
indexes. Add indexed revision_input_pins with scoped input/revision FKs and exact
hash/size. Append pins in the same transaction as immutable revision creation;
require authoritative published state. All retained revisions protect their pins.
Backfill bounded rows from existing manifests; inconsistent pins stop migration.
Preserve receipts/revisions/IDs; applied002 remains unchanged. Existing published
rows enter publishing for byte verification before accepting new pins. Existing
staging rows enter failed/unverified_legacy; offset0 recovery cannot create them.
Use version1, actual workspace root and name `input-<id>` for old rows, with offset
bytes for old published/offset0 for old staging. Initialize usage from every old
payload+metadata charge; keep over-allocation charged and block new reservations.
Retained historical pins survive the publishing fence. Never fabricate files.
Namespace deletion must reject retained input dependencies; recursive cleanup and
future tombstone removal need their own bounded fence/retention contract.

Use a canonical private installation root, derived UUID/hash paths, exclusive
0600 regular single-linked files and0700 directories; no symlink parents/aliases.
Published layout: inputRoot/organisation/workspace/inputId/sha256, matching the
existing provider. Backend alone writes; agent mounts published subtree RO with
the same numeric UID. Staging is a sibling on the same filesystem, outside that
mount. Engines receive only their existing per-attempt staged subset.

At most two original byte operations globally and one per input, including reads,
recovery and cleanup; no waiting queue. Streaming uses <=64KiB buffers. Abort or
timeout fences subsequent work but retains original open/read/write/flush/close
ownership until settled; uncertain cleanup cannot free a slot or storage charge.
Close fences intake and drains originals. Metadata remains one bounded worker.
Published content reads and deletion share input ownership; no disappearing file
mid-response. Content uses safe attachment/octet-stream headers and bounded ranges.

## Native service boundary

Private [byte jobs](../../../app/src/ports/input-bytes.ts) separate result from proven
custody settlement; [the service](../../../app/src/ports/input-service.ts) alone owns
global2/per-input1 admission. Capture canonical keys/requests/ranges before awaits.
Invoke lazy chunk/sink callbacks only after owning capacity and current-state checks.
Reads use one end-exclusive range within declared bytes (omission selects the full
file); verify the complete published identity/hash before sending bounded chunks.
Writes await consumer backpressure. No second adapter semaphore or waiter queue.

Every original file AND directory descriptor closes once. Result success requires
successful close; cancellation cannot retire a held original. Failed close reports
fixed cleanup failure, fences service intake and keeps job/handle/slot reachable;
settled remains pending and close cannot claim drained. No close retry or GC release.

No-overwrite publication uses same-filesystem link(staging,destination), destination
parent flush, proven staging unlink and source parent flush. During publishing only,
exactly two deterministic names may alias one verified dev/inode with nlink=2,0600,
same UID and exact bytes/hash; compare both names with the opened descriptor and
recheck ancestry around each step. Refresh identity after intentional link/ctime
changes. Restore and verify destination nlink=1 before metadata publication.
Staging-only nlink=1 may promote; destination-only nlink=1 may verify/flush and finish.
Distinct inodes, a third link or unexpected ownership/hash never authorize overwrite
or unknown unlink. EEXIST uses this recovery classification. Unsupported link or
directory sync fails closed; no rename/copy fallback. Agent provider stays unchanged.

Transient IO/cancellation preserves staging/publishing state and charge. Only conclusive
missing/corrupt custody after originals settle justifies terminal failInput; ordinary
IO must not irreversibly disable publication recovery. Deleting may record io reason
while retaining its state/intent. Unknown metadata outcomes cause no internal retry,
compensating delete or dependent byte work; explicit later calls reobserve the row.
Recovery re-gets each admitted item from one page<=100, returns bounded counts/cursor,
and skips busy rows without waiting. Restart scans from the beginning after a pass:
state-order movement can move work behind its cursor. Page end is not completion proof.

## Acceptance packets

First: metadata migration, charge/progress intents and indexed pins; independently
attack FK/state/immutable identity constraints and competing reserve/pin/delete.
Second: actual create/append/seal/status/delete/recovery service wired to metadata,
with real publisher -> InstalledProviders -> Stager bytes including empty/UTF8 data.
Third: guarded binary HTTP/generated control clients and full upload/list/read/delete
UI. These packets preserve the complete feature; no metadata-only public publisher.
Test restart at every flush/offset/publishing/rename/commit/unlink boundary; wrong
scope/folder/hash/size, duplicate/overlapping chunks, zero-byte quota exhaustion,
ENOSPC, symlink/hardlink/special files, pinned deletion, cancelled/held originals,
close failure, two-slot saturation and unknown-control replay. Source-only reviews
do not establish native filesystem latency, Node24/image or release qualification.
