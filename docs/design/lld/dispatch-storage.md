# Durable application dispatch storage

Status: SQL and metadata RPC implemented; installation dispatcher runtime pending.
Owner: application SQLite worker. Migration005 is reserved here; do not edit004.
[Run intake](run-intake.md) owns immutable intent/receipt acceptance;
[observation merge](attempt-observation.md) and [agent facts](agent-admission-evidence.md)
own chronology and remote release evidence. No second merge/compiler in this adapter.

## Private port and bounds

ports/dispatch.ts owns DispatchStore: scan, readOffer, claim and observe.
DispatchKey contains runId and the exact original five-field attempt identity,
including generation 1. Validate/bind every key/request/result at parent and worker.
The interface is installation-private, with no browser route or credentials.

scan({lane,limit,cursor?}) returns <=limit items, allowed 1..32, reply <=64KiB.
Each item has key, stable order, after continuation and advisory eligibility.
Cursors <=1024 bytes bind lane/installation and an inclusive captured upper order;
new arrivals wait for the next pass. after resumes after that item; nextCursor
continues after the page or is null at the captured end. No live append stream can
prevent revisiting an older blocked prefix. Queue order is a durable safe monotone
integer allocated on insertion, not wall-clock requestedAt or mutable retry time.
Untracked unpublished rows use diagnostic order 0; cursors include attemptId to
break that tie. They supply no charge or delivery authority.
Reconcile scans retain charged unknown/acknowledged attempts, at most64 originals;
capacity/settings/profile changes never hide them. Queued scans use compact facts.

readOffer(key) returns {key,offer} with the original parsed Offer, not an escaped
JSON string or a recompiled config. Request <=1024 bytes; reply <=2162688 bytes
(2 MiB Offer plus 64 KiB envelope). Reserve one existing TWO shared suite/Offer large
worker-original credits BEFORE worker parsing/serialization; no extra pool.
Stored Offer must equal its prescribed round-trip serialization and exact key.
No current capacity/profile gate prevents observing an already-possible delivery.
Preserve the original Offer's shared node/depth/collection limits independently.
The closed {key,offer} carrier adds exactly9 nodes and1 depth; the worker result
envelope adds another4 nodes and1 depth. captureDispatchOfferReply owns closed
descriptor capture, original subtree validation, exact identity and byte accounting
for SQL, worker producer and parent consumer. Never reapply the original-root JSON
cap to those carriers or widen the generic codec. Two original slots bound count;
stored text, encoder parts/string, parsed copies and native clones need their own
bounded accounting and qualification; they are not exactly2MiB resident memory.

claim(key) has a compact request/reply <=64KiB. claimed and replay permit PUT of
that same original; acknowledged forbids a new PUT; blocked carries a typed reason.
observe({key,snapshot}) request <=75776 bytes; reply <=1MiB. Snapshot itself is
bounded by the existing 73728-byte merge owner. Keys never become remote evidence.
All original requests/replies remain owned through completion or worker termination;
parent timeout fences that Metadata owner, not proof of rollback or cancellation.
Internal operation/reply control fields allow <=1024 extra bytes, independently of
the unchanged private request/value bounds; they grant no larger original subtree.
The composition root supplies the matched trusted worker; its fixed reply producer
bounds payloads before native cloning. Receiver validation is not a sandbox for
arbitrary worker code or an independently bounded native structured-clone stream.

## Persistent intent and initial enqueue

Add execution_intents with a unique monotone order, attempt/run/scoped identity,
canonical original registry digest, profile alias, numeric budget, mode and exact
policy1 staging breakdown. Use the shared estimator once while the existing enqueue
transaction already holds the bounded Offer. Insert summary, run, attempt, outbox
and original receipt atomically. Cost/identity/order are immutable, including REPLACE.
Store scalar eligibility fields; never parse Offer/config while scanning queues.

Migration005 preserves existing rows without full-Offer/history backfill. Missing
summary is explicitly untracked_intent, not permission to deliver or recreate it.
Any untracked possible-delivery or acknowledged identity without authoritative
release blocks new claims with ownership_unknown, regardless of public Run state.
Terminal/lost/exited is not release proof. Bound this separately from the pending
isolation query: migration005 must provide indexed untracked-evidence lookup for
possible outbox entries and generation-bearing attempts without an outbox. Markers
may reflect owned summary presence, never infer execution release or require a
history/Offer payload scan. Reads/receipt replay stay available; no silent deletion,
repricing or auto-recreation. Legacy config/history migration remains out of scope.

## Logical capacity and fairness

One immediate claim transaction reads persisted installation policy and one complete
fresh RuntimeObservation from the existing cache. Add a private Settings.capacity()
view of {installation,runtime}; runtime uses currentObservation, never a new sampler.
Recheck its original lease before authorization commits; do not refresh timestamps.
Use min(user, runtime) for pool/per-run ceilings and allowed profile intersection;
current registry must exactly match the original binding. Do not re-resolve accepted
organisation/workspace defaults, mutate requested budgets or raise user limits.
Agent idle/thermal/headroom policy remains final physical authority.

Retain immutable logical CPU/RAM/PID/output/staging cost and one concurrency unit
before first possible delivery. Sum <=64 active charges with checked arithmetic;
excess/inconsistent recovery fails closed. Subtract these ONCE from total ceilings,
not again from an already reduced agent reservation view. Lowered caps drain without
killing existing work. Unknown source blocks new claims, not observation/replay.
Output storage reservation uses its [shared owner](output-allocation.md).

Isolation is installation-wide across organisations and unknown charges. Any active
isolated charge blocks every other new claim; isolated requires zero active charges.
Freeze two evaluations in the shared eligibility owner. Individual feasibility
checks current total execution/per-run/profile/staging ceilings plus current shared
storage fit, ignoring execution occupancy/concurrency/isolation locks. Storage fit
includes all existing input/output allocations; execution drain does not free them.
Actual claim fit additionally subtracts execution charges, checks concurrency and
enforces isolation. Never subtract active execution cost when deciding whether an
isolated intent establishes the drain barrier.

The oldest individually feasible queued isolated intent blocks younger parallel
claims while work drains. Older parallel work may progress. Individually impossible,
profile-blocked or currently storage-blocked intents do not establish a barrier;
re-evaluate current policy/usage each claim. Newly feasible predecessors cannot be
missed by a stale scan. This does not promise future storage from retained data.

The claim transaction evaluates that barrier against at most 4096 compact pending
rows under current policy. Bound the pending query before interpretation; overflow
fails, never truncates the barrier. Force/verify query plans driven by pending
outbox indices, with no historical payload scan. Discovery still returns <=32.
This finite SQLite-only scan avoids persistent cached eligibility/barrier state;
qualification must measure its worst-case cost and demonstrate bounded rows/memory.
Use the same eligibility owner for advisory scan and authoritative claim.

## Possible delivery and recovery

The runtime may hold ONE captured Offer between readOffer, compact claim and network
issue. No preloaded Offer backlog. A single non-overlapping delivery loop can admit
many independently executing engines. Alternate bounded new/reconciliation turns.
Use the SAME installation gateway/credits as capacity; shutdown drains originals
before gateway then metadata. No automatic second attempt or target-load retry.

First claim atomically inserts the logical charge/output reservation, marks
outbox.possible_delivery=1 with immutable first_delivery_at, and moves queued Run to
dispatching. Persist before PUT. Increment Run.version only on a public DTO change;
safe-integer overflow aborts the whole transaction. No charge on typed refusal.
Once possible, replay keeps original charge/Offer and bypasses new-work policy;
reconcile first, then only an unacknowledged outbox may reoffer the same original.
Lost reply/timeout/404/429/profile drift never proves absence or frees charge.
Only one original per attempt; abort is not completion. Replacement awaits old
Metadata termination. Acknowledged attempts remain in active reconciliation storage.

## Matched observation transaction

Require a prior possible-delivery record and full immutable key. Invoke the pure
merge on the captured attempt identity, stored previous snapshot and incoming one.
Generation1, merged snapshot, current attempt state, public Run projection and outbox
deletion commit atomically. Store generation BEFORE deleting uncertain outbox.
Cancellation is existing Run intent OR merged remote cancellation, never erased.
Snapshot high-water and locally durable event cursor remain distinct; no event ACK.

Only matched final admission rejected/released evidence changes executionCharged
from true to false; persist proof with that transition. It cannot be recharged.
Output allocation remains charged. Keep records/cost/proof for recovery and retention.
Final admission/lost/exited selects finalizing, with outcome/validation still pending;
never finish/pass here. Already terminal Runs do not reopen; private evidence can
advance without changing the terminal DTO or its version. Missing record, identity
conflict or incompatible witnesses fail with no partial mutation.

## Acceptance

Crash/lost replies around claim, PUT and observation; exact original retry and one
load stream; receipt replay during drift; atomic late failure/rollback; cross-scope/
generation/result mismatch; original large-slot saturation shared with suites;
slow worker/gateway drainage; lowered limits and charged unknown recovery; isolation
across organisations and page 32; newly feasible predecessors;4096-bound overflow,
query plans against large history; quota/input races; version exhaustion; final
admission releases only execution charge; no snapshot-derived event ACK or result.
Storage-only fixtures do not establish executable dispatch or real Docker load.
