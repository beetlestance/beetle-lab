# Durable event custody

Status: accepted boundary design; implementation and qualification pending.
Owner: application metadata worker; runtime orchestration shares the existing
delivery owner and private gateway. This completes event transport custody before
the separately owned artifact/result finalization work.

## Authority and discovery

`EventBinding` in `app/src/ports/events.ts` contains the exact DispatchKey and
stored journal UUID. Require retained execution identity, acknowledged generation1
and immutable output allocation before ingest/ACK confirmation. Scope, run, attempt,
digest, generation and physical authority must agree in every operation and reply.
Never replace authority using current capabilities or adopt old NULL bindings.

Discovery includes acknowledged originals after execution charge release, terminal
Run state or outbox retirement. An indexed scalar event-custody obligation remains
until separately frozen stream-closure/finalization authority clears it. Snapshot
sequence, execution release and empty batches do not prove event-stream closure.
Existing bound acknowledged records receive lazy bounded cursor initialization at
zero; existing unbound records appear as explicit `unbound` candidates, not invented
bindings. No Offer/history scan or bulk event backfill is permitted.

Use keyset `(queue_order,attempt_id)` and an index covering the pending obligation.
Capture an upper position for each finite pass; query at most limit+1 scalar rows
before interpretation. Page limit1..32, page<=65536 bytes, installation/lane-bound
cursor<=1024 bytes. Each item has an after cursor preserving unread successors.
Continuous later arrivals cannot extend a captured pass or starve old obligations.

## Private port and bounds

`EventCustodyStore` exposes scan, load, ingest, confirmAck and recordProblem. The
typed shapes and constants live in the port. No public HTTP or engine DTO changes
are required for this boundary. Metadata parent and worker independently capture
and validate every command; producer and parent validate bounded replies.

Load/state replies<=4096 bytes. State holds binding, durableThrough,
ackConfirmedThrough, coverage contiguous|partial, blockedReason, retainedStartSeq,
retainedBytes and eventCount. Integers are safe/nonnegative; ACK confirmation never
exceeds local durability. Capture unknown JSON with existing descriptor-safe
encoding; reject getters, exotic objects, node/depth overflow and extra fields.

Application batch maximum is100 events/262144 bytes, matching the actual journal
producer; the broader runner schema alone is insufficient. RPC command maximum is
batch bytes+4096, with original batch node/depth limits checked independently of
carrier overhead. At most two event-batch originals share the existing metadata
large-original lane with suite/readOffer commands; no separate unbounded pool.
The gateway remains installation-owned and shares its existing native-call credits.
Each canonical event<=66048 bytes, matching the producer's control-frame+512 envelope.

## Pure batch validation

One pure domain owner captures the batch, validates EventBatch and nested identities,
and returns bounded canonical event records. No SQL, network or lifecycle projection.
Expose `prepareEventBatch({binding,after,batch})` through domain/events/index.ts.
Its result is `{binding,after,nextCursor,retainedStartSeq,records}`; each record is
`{seq,canonical,chargedBytes}`. Canonical representation includes the complete
validated AgentEvent; chargedBytes is its UTF-8 bytes plus EVENT_ROW_ALLOWANCE128.
Return deeply immutable owned data; compare duplicate canonical bytes, not object
ordering or a hash supplied by the peer. No second event compiler/mapper exists.

Require strictly consecutive sequences beginning at after+1, with safe arithmetic.
Nonempty nextCursor equals the final sequence; empty nextCursor equals after.
retainedStartSeq must be<=after+1 (safe comparison at maximum integer). A batch
claiming unavailable history is not permission to skip that history. Nested result,
exit, and artifact identities must match when present, including intentDigest.
after is checked against stored durableThrough inside the ingest transaction.

## Durable transaction and replay

Coordinator reserves application migration007 for event rows, cursor/counters,
obligation index and allocation guards. SQL rows FK-bind to retained execution and
output allocation. Legacy NULL journal authority stays fenced. Older binaries
reject schema7; failed migration preserves prior schema/data/foreign keys.

One BEGIN IMMEDIATE validates binding and captured batch, then compares at most100
existing replay records and appends only the exact next contiguous suffix. Reject
after>durableThrough. Equal duplicates are harmless and consume no additional
bytes/rows. A conflicting duplicate rejects all inserts/cursor/counter changes.
SQL length guards precede native JSON materialization; never load whole history.
Insert unseen immutable rows, update counters and contiguous cursor, serialize the
compact result before COMMIT. Any write/serialization/commit failure rolls back.
Only a returned successful durable result authorizes remote ACK up to ackThrough.
Lost ingest reply requires load/reopen reconciliation before a later ACK.

Remote ACK confirmation validates AckReceipt scope/generation and the requested
cursor: requestedThrough<=receipt.acknowledgedSeq<=durableThrough. Maintain
0<=ackConfirmedThrough<=durableThrough; confirmation is monotonic and idempotent.
Lost ACK or confirm reply retains a durable obligation. Retry the same-or-current
durable prefix under the same UUID, without refetching already pruned events.
No network I/O belongs inside SQL. Never infer local events from a remote ACK,
snapshot.lastSeq, Offer acknowledgement or terminal Run display.

## Output allowance and blocked evidence

Events consume a retained-control subledger within the original immutable output
payload allowance. Charge canonical UTF-8 bytes+128 per unique row, with total
<=min(maximum_payload_bytes,67108864) and<=65536 rows. This fixed row allowance is
logical accounting, not measured SQLite/index/WAL usage. Cursor/diagnostics fit
the existing64KiB metadata allowance. Physical backing-store reserve remains separate.
No second installation usage charge and no per-ACK refund is created. The complete
original output allocation stays charged. Future artifact/report adoption must
subtract this retained-control usage from the same payload allowance and account
for duplicate copies; it cannot claim the full payload allowance independently.

Quota overflow inserts no events and advances no cursor; persist an idempotent
quota_exhausted problem separately. Disk/worker failure does not manufacture a
problem write or success: fail through the existing retained runtime failure owner.
No automatic evidence deletion, execution retry, output release or invented user
cancellation/system-stop cause follows a storage failure. Agent resource guards
and deadlines remain responsible for physical execution limits.

recordProblem binds the same original and after<=durableThrough; it never advances
either cursor. Typed problems are cursor_expired, quota_exhausted, missing_receipt
and replay_conflict. Missing/expired information must come from a matched private
reply under the stored UUID, not generic404/authority mismatch. cursor_expired
requires retainedStartSeq>after+1; use overflow-safe differences and the shared
expiryCoverage helper. In the problem transaction compare against the CURRENT
durableThrough: if retainedStartSeq<=durableThrough+1, local history covers the
stale request's missing interval, so return unchanged contiguous state. Only a
gap beyond that prefix sets coverage partial permanently; block cross-gap
ACK until a separate reconstruction contract exists. Snapshot/seal names cannot
reconstruct missing intervals. Other problems retain the known contiguous prefix
and block further event mutation until explicit recovery authority is implemented.
Repeated identical problems do not rewrite counters or change their first evidence.
Runtime skips ingestion and further network mutations for blocked states while
retaining diagnostics and advancing fairness. Expected quota blockage is scoped to
that attempt; native disk/worker failure remains a fatal retained-owner failure.

## Runtime and shutdown

Extend the same nonoverlapping delivery runtime with a fair event lane; no new
gateway pool, per-attempt timer, in-memory event backlog or lifecycle mapper.
One turn selects one attempt and retains one batch original. Load durable state,
confirm outstanding ACK first, then GET from durableThrough, validate, ingest and
ACK only the resulting committed prefix. Fairness advances on remote uncertainty.
Local invalid commands/replies and storage failures fence delivery through its
existing failure/capacity-revocation owner. An aborted request proves no rollback.

Close synchronously fences new GET/ACK calls, aborts as a hint, and retains received
positive batches through their original storage decision. Drain issued ingest,
ACK and confirm originals before shared gateway and Metadata close. Positive ACK
replies already received during close retain confirmation custody. Do not issue
an ACK after close, even if an ingest committed while closing.

Ingestion changes private custody only. Existing snapshot observation owns Run
lifecycle; events cannot finalize outcome, engine validation or output allocation.
Artifact transfer/seal closure, final result mapping and public event/report reads
remain required first-release work after this transport boundary.

## Required evidence

- Late insert/cursor/counter/reply/COMMIT failure leaves no partial state or ACK;
  committed withheld ingest reply survives termination/reopen with exact rows.
- ACK applies remotely, reply disappears, agent prunes: reopen safely re-ACKs the
  stored prefix without double charging or inventing local events.
- Wrong UUID/scope/digest/generation; conflicting/reordered/duplicate sequences;
  empty-batch lies, leaps, cursor expiry and safe-integer overflow preserve authority.
- Released/terminal attempts stay discoverable among large history; captured-upper
  pagination remains fair under arrivals, with bounded SQL rows and no Offer reads.
- Maximum batch/event/carrier/node/depth; quota exact fit/overflow, disk-full,
  lowered settings, competing input accounting and failed problem persistence.
- Slow batch/ingest/ACK/confirm during close retains originals; no late ACK; Run
  outcome, output allocation and installation charges remain unchanged.
