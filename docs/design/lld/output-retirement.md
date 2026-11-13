# Agent output retirement and cleanup acknowledgement

Status: phased contract. Private retirement/native removal/receipt boundaries are
locally implemented; authenticated cleanup endpoint and refund remain pending. Scope: performance Run output. Standalone-export
cleanup needs a separate purpose binding; it must not impersonate a Run.
Owners: backend deletion intent, agent Journal, existing producer/read lifetimes,
and one native staging/output namespace owner. [Task sequence](../../execution/output-retirement.md).

## Existing boundaries and missing evidence

The [backend driver](output-deletion-runtime.md) persists each actual native plan
before unlink and reaches files_absent. It preserves source/absence closure,
execution/event facts and every allocation. That does not prove agent files absent.
Agent source/delivery or absence closure does not authorize its own deletion.
[Native failed closes](output-collection-custody.md) now retain strong owners and
admission slots; quiesced means settlement, not successful descriptor cleanup.

[C1 namespace/control](staging-namespace.md) now persists installed marker/root and
per-task four-directory anchors before work. Its process-local verified-root token
still gates actual Stager construction. Old admitted history without trustworthy
anchors remains recovery-required. Neither these observations nor PrivateSource's
output receipt establishes current absence, retired readers or released native IO.
A newly configured empty root cannot manufacture custody for retained data.

## Phase A: retire and prove physical cleanup

| Durable state | Permitted progress | Forbidden inference |
| --- | --- | --- |
| Captured deletion | Backend files_absent; preserve exact original closure | Terminal state or generic404 is not agent absence |
| Retiring | Immutable Journal intent fences future source reads/producer work | A caller timeout does not drain an issued original |
| Prepared | Persist actual native namespace/inventory/removal commitments | A digest recomputed from paths is not native custody |
| Cleaning | Replay that exact plan; record bounded per-entry progress | Missing entry without its plan is not fresh absence proof |
| Cleaned | Persist actual all-original-close and namespace-absence receipt | ACK alone does not purge metadata or refund any charge |

Positively proven unsent cancellations are a separate terminal branch. Reuse the
existing durable unsent witness: receipt-first cancellation removed an untouched
outbox, no execution record/allocation/generation exists, and the original intent
remains bound to that cancelled Run. Revalidate it at final settlement. Such a Run
never requests or synthesizes an agent cleanup receipt; a missing receipt/404 or
failed transport cannot qualify an original as unsent.

There is one retirement per agent-owned original attempt. Same intent replays; different
backend deletion ID/version, purpose, closure or namespace conflicts. A transient
transport failure never creates another cleanup generation or a replacement Run.

### Request and proof identity

The backend constructs the request only from its committed deletion row after all
captured backend file receipts. Browser/HTTP callers cannot supply native proof.
The agent receives no path, filename, amount-to-refund or artifact list from it.

The closed request contains protocol version1, performance purpose, canonical
organisation/workspace/Run/attempt/deletion UUIDs, generation1, intentDigest,
journalAuthority, immutable deletionVersion1, closure kind and closure digest,
and finalAgentSeq. For source, reuse the exact SourceReceipt identity/digests;
for absence, reuse the verified absence closure identity and proof digest. The
agent independently checks these against its current Journal rows. No generic
admission state or caller-provided final sequence substitutes for that closure.
Backend final event retention must already cover the closure horizon; agent checks
its acknowledged sequence reaches that same finalAgentSeq before cleanup begins.

A successful reply binds the entire request identity plus retirementVersion1,
namespaceIdentity, preparationIdentity and cleanupReceiptDigest. It exposes no
native paths, raw logs, secrets or config. The digest identifies a committed receipt,
not cryptographic proof of IO. Trust is the authenticated producer/Journal/native
owner chain. Both request and reply are capped at4096 encoded bytes before cloning,
body allocation and parse. Add exact schemas/vectors before the private runner
route; never overload cancellation, delivery ACK or source absence routes.

Use the existing expected-authority transport header and authenticated runner
channel. Status/replay use the same attempt/deletion binding. A mismatched authority
or intent conflicts and stays charged; attempt_not_found never means cleaned.
Only a positive exact committed receipt advances backend cleanup progress.

### Lifetime fence and races

Commit the retirement intent before destructive work. It durably excludes new
source manifests/chunks, staging, collection, native launch and delayed recovery.
Replay/observation can report the retired original; it cannot reoffer target work.

A source call acquires its bounded per-attempt read lease before its first await,
then checks the durable retirement gate before native IO. Local retirement fences
new leases before awaiting its Journal commit and drains all prior leases. After
restart the Journal gate, rather than an empty in-memory set, excludes new reads.
This ordering closes check/await/retire gaps; no second unbounded reader registry.
A failed intent commit leaves local intake fenced until exact status reconciliation.

Retire actual installation/controller/supervisor originals: preparation/providers,
watches, timeouts, drives, create/start/stop/collection and original closes. Inspect
and remove only the exact owned runtime under its existing settlement authority;
a stopped or missing container alone does not prove all native owners are gone.
Close failures remain sticky and refuse cleanup acknowledgement. Do not construct
an empty recovered controller to stand in for the previous runtime's retirement.

Source native leases remain owned through original result, quiesced and cached
close. Transport response/socket buffers retain their existing credits independently;
cleanup does not refund them or claim they are closed. A request still parsing or
starting after retirement must encounter the durable gate before opening files.

### Namespace and bounded native work

Before the first cleanup effect, bind Journal authority to the actual installed
staging namespace and persist actual task/input/output/secret-root preparation
facts. Use exact bigint device/inode strings, canonical ancestors and ownership,
not rounded numeric inode comparisons. Binding is immutable across ordinary restart.
A missing original anchor, changed root or unknown preparation requires conservative
recovery; never adopt the current root as the old original's custody by lookup.
New installation binding must distinguish genuinely empty history from old admitted
originals lacking anchors. A migration cannot invent missing native observations.

A native preparation validates all owned roots, runtime absence and reader/producer
drain, then inventories the complete owned task namespace before any unlink. Reuse
existing no-follow file/ancestor verification and cached original-close ownership.
Unknown ownership, links, special files, nested mounts, replaced ancestors, overflow
or incomplete enumeration refuses preparation. Preserve unrelated installation data.

Proposed per-task bounds:512 entries, depth32,4096 UTF-8 path bytes,128KiB serialized
plan,64KiB read windows and30s per issued operation. Bounds must include directory
reads, stat/open/unlink/fsync/close, plan serialization and recovery discovery.
The plan stores exact native facts and expected namespace changes; metadata persists
it before unlink. Resume uses that same plan and progress after lost replies.
No recursive rm, fresh absence plan from an empty wrong root, or unchecked ENOENT.
A partial/over-budget cleanup remains fenced and charged; qualification must show
these limits admit the supported generated job layout before they are advertised.

Cleanup uses the existing native owner registry and bounded shared credits; adding
one cleanup owner cannot race an unrelated opener for the same attempt. A positive
receipt waits every original descriptor close, fsyncs affected owned parents and
rechecks ancestor identities and complete owned-task absence after close. Failures
retain the original owner/slot and plan; cancellation cannot release custody.

### Durable quota and receipt lifetime

Reserve bounded retirement control/plan/progress/receipt capacity before admitting
a new original. Full retained payload/spool must not make safe cleanup impossible.
Charge actual metadata within that reservation; never enlarge quota on failure.
Existing originals without a trustworthy reservation need an explicit conservative
upgrade path, not guessed zero debt or an invented native plan. Admission changes
must cover performance and export purpose without granting export cleanup authority.

Persist the actual native receipt atomically with cleaned status. A lost COMMIT
reply is recovered by the same immutable key. Keep the receipt and original identity
available across backend retries/restart. Phase A preserves all disk holds, counters,
source/absence/delivery metadata, events and replay authority. It performs no refund.

## Phase B: separate final settlement

For source/absence originals, only exact backend-file receipts AND the committed
agent cleanup receipt permit a separately reviewed transaction to tombstone the Run,
purge eligible payloads and
refund each exact allocation once. Positively proven unsent cancellations use the
separate no-agent branch above, with no fabricated physical ACK. Backend and agent
have separate atomic owners;
use persisted ACK/progress, never a cross-database fiction or timeout compensation.
Keep enough replay authority to reject a late original Offer without executing it.
Compact tombstone quota/expiry and safe Journal payload reclamation require explicit
contracts before purging replay records; deletion must not recreate target work.
Public deletion/retention apply stays unavailable until this end-to-end path works.

## Required proof

Actual native roots plus compiled Journal/backend workers and authenticated runner:
held read/close through retirement, late source/drive rejection, wrong authority,
root replacement/empty wrong mount, restart before/after intent/plan/unlink/receipt,
lost replies, full control quota, late cancellation, plan overflow and sticky close
failure. Prove target side effects are not repeated and all charges remain unchanged
through Phase A. A physical ACK is not release qualification or freed host blocks.
