# Durable output delivery closure

Status: independently reviewed exact contract; unused interface declarations
only, implementation pending. Coordinator reserves agent migration013 for this
boundary. Refines the producer
barrier in [output transfer](output-transfer.md), using the existing immutable
[source receipt](output-source-journal.md). It does not publish backend results.

## Exact private value and port

agent/src/journal/output-delivery-protocol.ts declares OutputDeliveryClosure and
JournalOutputDelivery. Closure is closed {version:1, receipt:SourceReceipt,
finalAgentSeq}. Receipt must equal the verified durable source receipt under this
physical Journal UUID and original generation1 scope. finalAgentSeq is integer
0..MAX_SAFE_INTEGER, captured from accepted_attempts.last_seq by the worker inside
the closure transaction. Caller supplies no final sequence, timestamp, epoch or
new UUID. No HTTP request may submit or manufacture this trusted closure.

closeOutputDelivery(receipt)->closure and readOutputDelivery(scope)->closure|null
reuse the existing Journal queue/timeouts/FIFO shutdown and two source/large
original credits before input capture. Close wire JSON<=1024 UTF-8 bytes before
clone and worker parse; read uses existing owned Scope. Complete closure JSON
<=1024 before worker reply/native materialization. Parent replies are owned/frozen,
closed-shaped, scoped and matched to the original receipt. Unknown/corrupt state
is unavailable; malformed requests invalid_input; mismatched source/state conflict.
Known original with no closure returns null, never a sampled current stream end.

## Durable transaction and late-append fence

In one immediate transaction, verify existing source/intent/reservation/disk hold
and exact receipt using their current owners. Require physical reservation release
with the stored source's exact finished evidence. Capture current last_seq, insert
one immutable closure and its exact JSON+256 metadata charge, then commit. Return
an exact prior closure on equal replay even after worker reopen; no second charge.
Receipt/source mismatch conflicts. Source-less old released rows acquire no closure
or fabricated source. Inconsistent persisted row/source/sequence/charge is unavailable.

Add delivery_bytes (integer0 initially) and output_delivery_closures FK to the
original source. All seven live charges include delivery in preflight/SQL quota;
ACK/prune/physical release cannot refund it. Preserve001..012 definitions and their
historical guard templates. A new migration installs the current replacement parent
quota guard in migration013. No undefined-counter defaults.
Immutable child INSERT/REPLACE/UPDATE/DELETE and parent counter forging refuse.
Migration data/DDL/version/FKs commit or roll back together without source backfill.

A durable closure fences all unseen event_spool INSERTs and changes to the original
sequence/source high-waters or result/checkpoint. Existing exact duplicate replay
may return unchanged prior receipts without appending or advancing any sequence.
ACK/prune, immutable source/receipt reads, and non-event cancellation metadata remain
available. SQL captures and guards the fixed stream end; no snapshot read or JSON
assertion proves producer quiescence. Read validation checks finalAgentSeq still
matches the fenced last_seq and exact source, including after pruning and reopen.

## Durable discovery and scheduler fairness

Physical release removes the original from the charged lane. Persist an indexed
accepted_attempts.delivery_pending boolean in the same source insertion/charge
transaction, clearing it only with the matching durable closure/charge. No history
scan or backend request is needed to discover a released source lacking closure.
Existing schema12 source rows receive only this obligation marker during migration,
not a source/closure authority backfill. Bound the source-ID preflight to4097 and
refuse above the existing4096 retained-hold ceiling before any unbounded transfer.
Use the source table's existing key/index; never parse all source JSON to mark debt.

Extend private scanRunnable with lane=delivery and optional through safe integer.
charged/queued retain their exact existing request/reply behavior and reject
through. Delivery limit1..32, cursor nonnegative numeric; first page captures
through=max eligible accepted ID (0 if none), later pages preserve that upper.
Reply is existing bounded attempts/cursor plus through; every SQL query filters
an indexed delivery_pending=1 and cursor<id<=through before LIMIT+1. No source or
Offer body is returned. Native source insertion must replace its current AFTER
trigger in the new migration to update source_bytes and delivery_pending together;
a separate trigger cannot transiently violate the exact child-charge guard.

Scheduler shares its existing64 original drive slots, no additional pool/queue.
Rotate first lane each pass among charged/delivery/queued; each noncharged page
uses at most min(32,remaining slots). Charged retains its existing rotating order.
Advance only a considered page, reset a completed delivery pass to capture a new
upper, and retain cursor/through independently from queued. A full old work map
prevents new dispatch until originals settle; no timeout releases native custody.
This keeps delivery and queued work from permanent starvation under64 charged
attempts, without lowering engine admission concurrency. Discovery grants only
normal source-first drive/reconciliation, never a launch or deletion permission.

## Concrete manager producer ownership

The installation manager has at most64 entries and64 public originals. Each
entry-affecting public drive/cancel/stop/cancelOriginal operation must acquire an
owned completion lease synchronously before its first foreign await. Keep the
actual lease promise until its finally/cleanup completes, not just entry.users or
version. The drive lease is separate from subordinate cancellation/preparation work.
Watch/timeout handles own all their issued callback originals through cached close.

Before source delivery closure, atomically set the entry retiring flag, blocking
new producer leases and entry recreation while it remains in the map. Capture the
one closure-calling drive lease as the sole excluded lease: awaiting that same drive
would deadlock. All other earlier public leases must drain, including callbacks
that settle after the retirement fence. Stop new staging/watch/controller creation.
releaseProvisional must never remove a retiring owner.

Then drain preparation result+quiesced and cached watch/timeout closes, including
all their already-issued callbacks. Only afterward re-read and drain the final
cancellation chain, including chains assigned by drained public leases or watch
callbacks; then close/retire controller/supervisor originals. Recheck sticky cleanup
state after draining. Existing
Manager.retire's initial three-Promise snapshot is insufficient: cancellation may
be assigned after that snapshot. No producer may be orphaned by deleting the map.
Only after these originals quiesce, request closeOutputDelivery and validate its
exact source receipt and closure. Hold the retiring fence through any ambiguous
close; only a known durable closure permits memory-owner removal. Source/metadata
quota or unknown close leaves the owner fenced and retained for reconciliation.
Global shutdown drains its public work before retirement; it has no self drive lease
and may not bypass the same barrier or create new native work on a retiring owner.
Cached original close failures stay rejected. Cache native retirement separately
from the metadata closure attempt: a metadata error does not undo successful drain.

## Reconciliation, late calls and restart

A retiring entry admits at most one serialized reconciliation-only drive after its
previous active drive settles, sharing the same global64 originals. It never
reopens producer admission or creates staging/watch/controller/native work. Reuse
cached native closes and the immutable source receipt. Wait any earlier issued
close original/Journal FIFO quiescence before reading closure; exact stored closure
wins, and only proven absence on a usable Journal permits replay of the same close.
A quota failure may therefore recover in the same manager after ACK/prune creates
headroom. A settled lost reply can reconcile without restart. An unresolved original
or failed Journal remains fenced/unavailable; sticky native close failure never
resets. Exclude only this actual reconciliation caller from its own completion wait.


No unbounded in-memory tombstone map is required. After deletion, source-first
recovery must reconcile the stored source/closure before creating any native
producer. A recreated owner around a committed source performs receipt release/
producer retirement/closure reconciliation only, with no catalogue or engine work.
A current retiring entry rejects new producer admission as busy, without queueing.

A source already committed proves that engine/output collection stopped; late
cancel/cancelOriginal may persist their existing non-event cancellation metadata
and return a matched snapshot, but must not create/signal a native producer or
append beyond the closed stream. They still match the original Offer/scope and
physical UUID; no fresh refusal/current catalogue substitute is introduced.
Calls admitted before the retiring fence retain their leases and finish normally;
the barrier waits them and includes every resulting event before closure. Source
absence never grants this late-call exception. Durable append guards fence any
stale producer after crash/reopen. Native cold-restoration authority remains a
separate installation contract, not permission to continue an old stream.

This source-backed closure excludes refused/unstarted/failed-without-source cases.
Those still require an exact nonexecution/error closure before first-release
qualification; do not fake EngineResult, failed collection or backend publication.
No source-file deletion, application finalization ACK or storage refund is added.

## Required oracles

Actual indexed discovery includes released source debt after manager/Journal restart,
finite upper passes amid new arrivals, source/closure marker atomicity and rollback,
no payload/history materialization, and scheduler lane fairness with64 charged
originals. Saturation/disconnect/shutdown retain original64-slot ownership.


Actual compiled Journal: source/release prerequisites, exact close/read/reopen,
actual withheld COMMIT reply and unchanged charge, byte/JSON limits before clone/
parse/native materialization, wrong UUID/scope/source, native immutable/counter/
late-event/high-water forgery with recursive triggers OFF, exact quota/one-byte
short/rollback and ACK/prune retaining charge. No epoch/time-based automatic closure.

Actual Manager: hold a prior cancellation before signal assignment, start retirement,
refuse reentrant new producers, release that cancellation and keep closure pending
through its resulting native actor/watch/descriptor close. Exclude only the actual
closure caller, not another drive. Concurrent guard/timeout/close and global shutdown
must retain every original. Withhold closure reply and retain owner/fence; replay
same source after restart. Also prove quota failure->ACK/prune->same-manager closure
retry and settled ambiguous reply->same-manager exact read/reconcile, without any
new native producer. Late cancellation on a closed source changes no sequence
and performs no actor/stager/native work. Inspect original rows/counts/handles, not
only fake service return values. Synthetic engine observations are not native k6
or backend publication qualification.
