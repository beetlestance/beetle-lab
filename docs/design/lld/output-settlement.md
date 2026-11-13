# Output settlement

Status: values and local ownership gate implemented; settlement transactions remain gated.
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

## Separate protected branches

Positively unsent cancellation uses the existing foundation/current-intent/one-attempt/
cancelled/outbox-absent/execution-absent/allocation-absent witness. It does not fabricate
an agent ACK and needs only its own atomic backend settlement. New enqueue funds
control before work is published; preserved unfunded legacy rows need explicit top-up.

Sent never-admitted originals have no genuine retained disk hold and cannot borrow
its staging credit. They need a separate positive no-reservation/no-native authority
and explicit permanent replay funding rule. Until implemented, they remain charged/
protected; a missing reservation or generic absence response is not that rule.
Standalone exports remain outside this performance settlement qualification.

## Qualification before public deletion

Exact original/scope/digests, conflicting replay, SQL insertion/update/delete bypass,
late Offer/cancel/producer calls, full pool, lower limits, transactional rollback,
retained input pins, lost committed replies and actual worker reopen. Exercise actual
native cleanup through authenticated HTTP and both compiled workers; prove exact
logical credits once, stable tombstone replay and no repeated target execution.
Preserve close ownership and failure evidence; do not repeat unrelated green lanes.
