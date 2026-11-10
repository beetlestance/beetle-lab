# Output source Journal transactions

Status: proposed exact transaction/wire amendment; review before implementation.
Value/intent contracts: [source commit](output-source-commit.md) and
[collection intent](output-collection-intent.md). This page owns the additional
private release operations and migration/wire allocation, not filesystem truth.

## Private interface and original ownership

`agent/src/journal/output-source-protocol.ts` declares six JournalOutputSources
methods. They are controller-only, never agent HTTP or engine-wrapper endpoints.
Normal admission types do not import source types: that would reverse the existing
source->admission dependency and create a cycle. All methods reuse existing Journal
queue ownership, timeouts, shutdown FIFO and two large-original credits. Classify
all six operations as large, including bounded replies, before any caller capture.
Cancellation/close retain their existing independent lanes/reserved close slot.

| Operation | Private wire contents and UTF-8 cap |
| --- | --- |
| outputCollectionBegin | Canonical CollectionIntent JSON<=32768 |
| outputCollectionRead | Existing owned generation Scope; reply intent or null |
| outputSourceCommit | Parent prepares/canonicalizes complete PrivateSource JSON<=131072; worker fully verifies it |
| outputSourceRead | Existing owned generation Scope; reply complete source or null |
| outputSourceRelease | Closed SourceReceipt JSON<=1024 |
| outputCollectionFailed | Closed FailedOutputCollection JSON<=8192 |

The public commit method still accepts CollectedSource, not an unverified private
source. Parent prepares it with the accepted codec and local SHA256, encodes the
bounded record before worker cloning, and preserves that request through ambiguous
completion. Worker validates string/type/UTF-8 size before JSON.parse and verifies
the source again. CollectionId is its release.collection.evidenceId. The parent
checks a commit reply against its own prepared expected receipt; a mismatched or
malformed reply is unavailable, never a fabricated successful commit.

Reads return owned frozen values only after codec/scope checks, using SQL byte
CASE bounds before source JSON crosses into Node. null means a tracked original
has no such record, not that files are absent; unknown attempts retain not_found,
wrong generation stale_generation, and inconsistent/corrupt records unavailable.
Begin replay returns the exact original intent; conflicting replay conflicts.
No new worker pool or source enumeration/history scan is introduced.

## Migration and accounting

Reserve agent migration012 after this amendment's review. Preserve migrations001
through011 and their historical guard definitions; new guards that reference new
columns must be installed by012, not retrofitted into011's standalone SQL.
Migration012 creates the previously declared intent/source tables and adds
accepted_attempts.collection_bytes/source_bytes, both integer0 for existing rows.
Do not manufacture intents, sources or receipts for old active/released attempts.
DDL, guards, fields, version and FK checks commit or roll back as one initialization
transaction. Existing authority/quarantine and retained disk debt remain intact.

Each charge exactly matches child presence and canonical stored JSON bytes+256;
ceilings are33024/131328. Add both fields to every live quota equation/preflight,
including spool/projection/checkpoint/admission and the012 replacement for the disk
parent-update guard. ACK/prune cannot refund them. Immutable child payload/scope/
digests/charges and accepted counters reject UPDATE/DELETE/REPLACE forgery. Initial
source/intent insertion is active-only and FK-bound to the exact admitted original.
No current setting, catalogue or free-space sample replaces original promises.

Keep historical metadataColumns compatible with migration011's bounded validation
reads. Add new quota fields to current full owner queries where they are actually
used; do not default missing/invalid counter values to zero. Standalone historical
migration proof is separate from executing current operations against old schemas.

## Worker transactions

One worker-owned per-open random epoch is captured by its Store/source owner; it
is never a command field. Exact existing intent replay preserves created_epoch.
Journal UUID is stable physical authority and must not be confused with that epoch.

Begin validates current authority, original scope/intent/engine/InstalledIdentity,
reservation spec/create/runtime/settled launch, retained hold, exact checkpoint and
journaled result before charging/inserting pending intent. Root mount/uid provenance
comes from the trusted original prepared-plan controller; the Journal has a stored
specDigest, not permission to invent or reload a current runtime plan.

Commit validates the same durable originals and the pending intent's collectionId,
root, checkpoint, launch/runtime bindings and chronology. It compares the full
verified result to the stored result. Source/charge and pending->sourced transition
commit together; exact replay returns the prior receipt without a second charge.
Already released originals cannot acquire their first source. An exact existing
source can be read/replayed after release. Source/intent phase contradictions fail
closed on both presence and absence reads; sourced intent without its source is
unavailable, not a null source that permits recollection.

Malformed requests map invalid_input; scoped replay/state disagreements conflict;
quota shortfalls quota_exceeded; corrupt persisted state/native failures unavailable.
Reuse existing error codes; no error text exposes source paths or secret values.
No filesystem/network work or foreign digest callback occurs inside a transaction.

## Physical release gate

releaseOutputSource accepts only a candidate receipt, matches its exact authority,
scope and both digests to a verified durable source, then reuses the stored release
observation through existing releaseSettled/requireSettledRelease. Do not regenerate
timestamps/evidence IDs or duplicate release logic. Release and disk active->retained
transfer remain one immediate transaction. Replay returns the same reservation.

failOutputCollection requires matching pending intent/collectionId, worker epoch,
original launch/runtime evidence and collection.state=failed. The collection evidence
ID is collectionId; its observation is >=begunAt. Runtime evidence equals the stored
intent runtime. Reuse the existing settled-release validator and atomically mark
intent failed with physical failed release. Arrange SQL phase transitions around
the reservation update so no per-statement guard requires a circular prior phase;
the final committed phase/reservation/source relations must all agree.

The same uninterrupted controller must know genuine collection failure/quiescence
before any success/source issue. Epoch equality alone does not prove that lifetime;
same-Journal controller recreation always uses conservative recovered semantics.
SQL guards enforce durable data relations/quota; process-owner/epoch authorization
belongs to the Store/controller, not to a JSON assertion of native quiescence.

Normal admission.release must reject active finished collection: only the source
receipt operation can authorize that path. It must also reject active failed release
when an intent exists, requiring the explicit intent failure operation instead.
Exact already-released historical replay remains readable without receipt backfill.
Unstarted abort cannot refund disk or acquire a source. Failed no-intent release
retains existing stopped/quiescence proofs; the controller must never bypass a
pending/sourced intent or downgrade a source commit failure into that path.

Coordinate this gate and controller caller wiring as one complete feature before
claiming a connected execution path. Never retain a permissive compatibility path
just to make older finished-release fixtures green. A provisional component report
must name any caller/test work not yet connected; preserve legacy npm start.

## Acceptance

Actual worker begin/commit/release, same-path/authority reopen, withheld real replies,
exact replay and native row/counter inspection; source quota exact/one-byte short,
late COMMIT rollback, lowered quota, immutable native DML/REPLACE and epoch mismatch.
Prove SQL byte CASE bounds before Node payloads and encoded byte caps before actual
postMessage, without calling a post-hoc malformed-object test memory qualification.
Use real native stopped control/output collection for the connected source seam;
synthetic metadata facts alone do not qualify filesystem authority. Missing/wrong
receipt, pending intent failure after restart/expired execution deadline, and
same-Journal controller recreation must preserve charge and never rerun targets.
