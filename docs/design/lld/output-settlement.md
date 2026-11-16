# Output settlement

Status: automatic admitted/unsent settlement implemented; admitted-source native recovery qualified locally. Rejected no-admission funding and public retention remain gated.
Owning predecessors: [retirement](output-retirement.md),
[backend control](backend-cleanup-control.md). Root owns migrations agent022/backend024.

## Authority and ordering

Physical cleanup and accounting are separate. A valid shape, digest, missing row,
404 or elapsed time never grants a refund. Existing retirement continues unchanged
until the backend has atomically stored its exact immutable cleaned ACK after every
backend-file receipt. The backend then requests agent settlement, binding the exact
RetirementRequest and SHA256 of the canonical cleaned reply. The authenticated agent
rechecks its committed native receipt, plan and retired original in its own transaction.
It cannot read the backend database; the request is the coordinator's explicit release
instruction, not a cross-database proof. The backend keeps its debt during uncertainty.

Before agent accounting, a local per-original settlement barrier fences new retirement,
inventory, removal, receipt and cleanup-carrier work and drains their actual originals.
A persisted native receipt alone does not prove concurrent replay descriptors closed.
Failed/uncertain drain retains its ownership and all charges; it grants no purge permit.
The durable tombstone fences Offer, cancel, admission and producer paths before effects.

The shared gate is keyed by the physical Journal.retirements port, with64 originals,
256 leases and2 fences. Every cleanup service acquires at entry, including direct
process methods and inventory persistence. Native operations retain their lease until
actual close; failed metadata joins actual worker termination. Opaque drain observations
bind owner and exact retirement request and remain valid only while the fence is held.
HTTP control originals retain request/response/socket closure ownership before release.
A two-entry coordinator reserves capacity and captures the deadline before read-only
worker preflight. Positive eligibility precedes the local fence; the commit revalidates
it in its own transaction. Cancellation withdraws only unissued waiters and invalidates
minted observations synchronously, retaining actual native leases. It refuses withdrawal
while a mutating carrier exists. Root stops unissued waits before joining shutdown.
Every failed metadata carrier joins actual worker termination; rejected termination
retains the entry/fence. Endpoint details: [evidence](../../verification/agent-settlement-http.md).
These implemented local rules grant no database eligibility or physical cleanup proof.

Agent settlement atomically stores a permanent immutable replay tombstone, purges the
covered original records, removes its retained disk hold, and transfers4096 logical
bytes from that hold's existing staging metadata allowance into explicit replay debt.
No concurrently retained copy may claim the same credit. A successful reply binds
settlement-request digest, cleaned-reply digest and tombstone digest. Lost replies
reconcile from that same tombstone after Journal reopen. Backend settlement follows
only an exact agent reply and atomically stores its own permanent2560-byte tombstone,
purges covered per-Run records and applies its exact remaining credit once.

Separate stores have separate atomic transactions. Neither store infers the other's
commit from a timeout or undoes physical cleanup to compensate. Recovery can finish
from agent-tombstoned/backend-still-charged state. The existing retirement endpoint
must replay the original cleaned reply from the exact agent tombstone after compaction.
This explicitly replaces C4's fresh-native replay only after durable compaction; the
pre-compaction pipeline still requires its original native checks. Settlement also
replays its exact tombstone reply. Conflicting request/Offer identities are refused.

## Accounting

| Owner | Existing current debt | Permanent floor |
| --- | --- | --- |
| Backend source/absence | retained payload +65536 output metadata +65536 cleanup control | 2560 |
| Backend positive unsent | existing65536 cleanup control; no output allocation | 2560 |
| Admitted agent | exact retained disk hold and nine recorded metadata charge fields | 4096 |

Backend source/absence finalization already credited maximum minus retained payload.
The immutable old allocation's charged_bytes is historical, so it must not be refunded
again. Input blobs remain separate owners: unpinning does not refund their bytes.
Global mutation receipts require an explicit retention decision; they are not silently
claimed as per-Run output credit. Store actual original credits in the tombstone and
reject underflow, unsafe arithmetic, contradictory facts and duplicate identities.

Agent C1 reserves196608 within per-original Journal quota. It is not a global staging
reservation. The4096 floor transfer is funded by a real removed disk hold containing
the65536 staging metadata allowance, after its covered consumers have been purged.
This does not establish global accounting for all C1 bytes. Admission must include
explicit permanent replay bytes even when heldCount is zero. HeldCount counts only
active/retained disk holds, so tombstones do not consume a live slot indefinitely.
Maintain tombstone count/bytes by bounded transactional deltas, not history-wide SUM.

No expiry exists without a separate durable non-replay fence. SQLite/WAL file sizes
and host freed blocks are not inferred from logical credits. Retention UI reports
logical settlement and preserves failed/pending work honestly.

## Compact values

Settlement request: version1, original RetirementRequest, canonical cleaned-reply
SHA256. Settlement reply: version1, state settled, request digest, cleaned-reply
digest, tombstone digest, chargedBytes4096. Closed finite schemas reject unknown
fields, malformed identities, alternate purposes and unsafe numeric values.
Digest prefixes separate settlement values from other protocols. Reply binding is
verified before persistence; metadata validation grants no native capability.

Agent tombstone retains the canonical cleaned reply, canonical original Offer digest,
settlement request digest and exact recorded credits. The cleaned reply already binds
scope, original, generation, journal authority, Run, deletion and native cleanup identity.
A late Offer is fenced before any new accepted row/admission/native work. Same identity
with different canonical Offer digest is a conflict; an identical original remains
retired. No new generation or auto-reexecution is created from a tombstone.
Backend tombstone retains exact scope/original/Run/deletion, closure kind and digest (null for the positive unsent branch),
ACK/agent-settlement identities, original retained payload/metadata/control amounts,
refunded amount and permanent floor. Full configs, paths, errors and artifact bodies
are excluded. Prove maximum complete canonical encoding plus logical row allowance
within agent4096 and backend2560 before authoring their persistence migrations.

## Implemented private agent owner

Journal022 owns immutable replay rows and O(1) replay counters. Its client holds a
carrier against the local fence through actual completion; failed termination does
not release it. Worker eligibility reuses existing retirement/receipt interpretation.
A private transaction frame matches exact original, table, canonical tombstone and
counter deltas. It inserts the tombstone before fixed FK-order purge and rejects
cross-original/global writes, unexpected residuals and foreign references. Full
rollback includes replay identity, old records and both counter families.
DiskRetention names replayBytes explicitly, independently of live heldCount.
The pipeline's exact tombstone replay runs before any new native work. Details and
remaining qualification: [agent evidence](../../verification/agent-storage-settlement.md).

## Backend transaction and retained owners

Backend024 derives the current terminal one-attempt original, zero outbox, no export
links, every backend file receipt, retained closure/events and immutable cleaned ACK.
The exact agent settlement reply binds that ACK before source/absence credit. Positive
unsent uses its existing no-delivery witness and no agent reply. Permanent Run/attempt/
deletion identities fence recreation, including case aliases. Reads/replay survive purge.

One private synchronous permit inserts the tombstone, deletes the fixed original tables,
then applies exact usage and replay-counter deltas. It refuses nested cross-original or
global writes. Lifetime backend events use their own65536-row admission bound, with
sentinel counts before projection. Payload/slot/file and scalar counts are separately
bounded. No unbounded history sum computes permanent debt.

The standalone transaction keeps foreign_keys enabled and defers the existing immediate
attempt/intent cycle until enforced COMMIT. It never switches deferral off early. A
failed COMMIT rolls back all originals, counters and replay identity. Unknown rollback
or protection restoration poisons later Store commands and attempts native close once.
Uncertain worker termination retains the private call rather than certifying settlement.

Run snapshots, attempts, events, output custody, cleanup controls and execution orders
are purged. Global mutation receipts, authoring revisions/input pins, input blobs and
name indexes remain unchanged; none receives a claimed credit. This is logical output
settlement, not secure erasure of all historical configuration or SQLite/WAL blocks.
Evidence: [backend settlement](../../verification/backend-storage-settlement.md).

## Automatic reconciliation and derivative readers

The existing serial cleanup runtime rotates file, retirement and settlement turns.
Settlement discovery captures a physical sequence horizon and reads at most32+1 rows
before readiness/ACK filtering. Its cursor binds installation, page size and semantic
lane. Released absence includes admitted never-started work. Rejected absence participates in both discovery lanes; its actual agent funding,
no-task receipt and exact settlement remain mandatory before credit. Source/absence use exact ACK-bound agent replies; unsent sends
no agent call. Cancellation joins issued originals and preserves uncertain backend debt.

A history job can outlive deletion. Its private metadata capability returns exact
scope/Run/attempt `deleting` or validated permanent `retired` state. Deleting jobs defer
30s without new metric reads, advancing the existing due index; retired jobs skip.
Held projection errors recheck that positive capability. Stale commit/defer returns a
retired marker only for the exact validated tombstone. Other missing/conflicting/unknown
records remain errors. Neither marker grants native cleanup or accounting authority.
Details: [reconciliation evidence](../../verification/settlement-driver.md).

## Separate protected branches

Positively unsent cancellation uses the existing foundation/current-intent/one-attempt/
cancelled/outbox-absent/execution-absent/allocation-absent witness. It does not fabricate
an agent ACK and needs only its own atomic backend settlement. New enqueue funds
control before work is published; preserved unfunded legacy rows need explicit top-up.

Sent never-admitted originals have no genuine retained disk hold and cannot borrow
its staging credit. They need a separate positive no-reservation/no-native authority
and explicit permanent replay funding rule. The separate16KiB control now funds this
branch; missing reservation or generic absence never authorizes it. Low-quota rows stay protected.
The private rejected funding path reserves16384 bytes before writing its exact no-task
retirement intent in the same immediate transaction. It requires the actual rejected
closure, final ACK, bound installation, absent producer ownership and original quota.
New funding counts all held staging, replay and existing temporary controls against a
fresh known pool; native free capacity covers existing future cleanup writes too.
O(1) counters cap funded originals at64 and preserve the successful funding clock.
All normal execution admission counts temporary debt. Exact funded replay bypasses
fresh space checks; conflicting identity and quota reduction remain fenced. No C1 or
hold is invented. Old1024-byte originals without enough quota stay protected.
Journal024 separately stores the no-task native receipt. Its owner validates the real
root/marker, deterministic task/container/mailbox absence and producer drain, repeats
named checks after native closes, and holds exclusion through opaque worker dispatch.
Receipt replay repeats native proof. The receipt grants no refund; rejected HTTP
discovery remains protected until settlement and composed native qualification finish.
Standalone exports remain outside this performance settlement qualification.

Local admitted-source native evidence: [settlement recovery](../../verification/native-settlement.md).

## Qualification before public deletion

Exact original/scope/digests, conflicting replay, SQL insertion/update/delete bypass,
late Offer/cancel/producer calls, full pool, lower limits, transactional rollback,
retained input pins, lost committed replies and actual worker reopen. Exercise actual
native cleanup through authenticated HTTP and both compiled workers; prove exact
logical credits once, stable tombstone replay and no repeated target execution.
Preserve close ownership and failure evidence; do not repeat unrelated green lanes.

## Rejected credit transfer

The v2 tombstone records explicit16384 no-task control funding, actual old metadata
charges and zero original disk/hold/C1 allocation. Its hash domain is separate; v1
canonical bodies/hashes stay unchanged. Journal025 revalidates the funded exact intent
and no-task receipt, then inserts4096 replay debt and purges exact original rows.
The temporary counter drops16384 once; all hold counters and funding clock remain
unchanged. Shared cleanup drain and actual carrier ownership still precede settlement.
Historical022 trigger SQL is frozen; new receipt/control guards permit only exact
private phases. Scope, stale proof, missing records and unknown ownership refuse.

Admitted abort-before-staging instead proves exact paid C1, released/aborted never_started
reservation and real retained hold with task.none. Journal026 preserves/renames the
no-task receipt table. Native proof remains mandatory; settlement uses the unchanged
v1 real-hold transfer and never decrements rejected-control debt. Prepared and unknown
tasks cannot use this no-task authority.
