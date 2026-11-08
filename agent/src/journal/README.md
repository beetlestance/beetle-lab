# Journal boundary

Entrypoint `index.ts`: `openJournal({path, queueLimit?, spoolQuotaBytes?, workerUrl?})`.
Node 24 packaging compiles sibling `worker.js`; retain `node:sqlite` in bundling.
Tests compile with pinned tsup into task-owned temporary directories.
`immutableOffer(unknown)` bounds/validates/copies Offer JSON (1 MiB), preserving
original identity text and canonical duplicate equality. Scoped get/read/cancel
and listOpen (100 lightweight snapshots) return current projected state. Listing
omits result payloads; scoped get owns the full-result read. Terminal rows remain
listed until collection/release/retention authority exists. Cancel persists intent.
`admission(command)` is the trusted production admission/ownership entrypoint;
see [admission contract](../admission/CONTEXT.md). Compatibility `immutableOffer`
does not validate installed engine semantics or reserve resources.

`appendWrapper(ControlEvent)` retains wrapper seq as wrapperSeq; `appendSupervisor`
accepts `{sourceOrdinal,event}` where event is a source:'agent' draft without seq.
One supervisor owns the ordinal stream per attempt/generation; other producers
feed that owner. `sourceCursors(scopedGeneration)` restores both source high-water
marks after restart. New source ordinals must increase; gaps are allowed. Identical
retained keys dedup; changed reuse conflicts; pruned/older keys return expired_key.
All wire AgentEvent.seq values are assigned by the journal, atomically with the
payload, durable source key, snapshot cursor and charge. Scope text must match.
Lifecycle projection commits phase/state, first exit witness and immutable canonical
result with that same transaction. Wrapper phases never regress; agent envelope
phase is not measurement evidence. A result cannot prove container exit, seal
authenticity, artifact custody, application finalization or reservation release.
Lost/exited resist delayed nonterminal events; actual exit can resolve lost.
Repeated exits accept newer timestamps/unknown refinements but retain the first
witness. A separate private known-facts frontier (<=1KiB) durably remembers every
confirmed field across later unknowns and restart; known contradictions conflict.
Cancellation events require
already-durable intent and never reset cancellation time.

Envelopes max 64 KiB; readEvents(key,after) yields <=100 records and <=256 KiB,
including batch envelope. Lengths are selected before bounded payload loading.
Default quota 64 MiB per attempt (override 1024..67108864 bytes for new offers only),
charging encoded event + canonical source JSON +256-byte row/index allowance;
max 65536 retained rows. This is accounting, not a physical SQLite disk bound.
UTF-8 phase/first-exit/known-exit-facts/result projection bytes also remain charged as snapshot_bytes.
Admission checks spool_bytes + new_snapshot_bytes + event_charge <= quota;
SQLite enforces the combined bound. Pruning refunds event charges only. Overflow
returns quota_exceeded without event, cursor or projection growth.

acknowledge(Ack) durably advances only the monotonic application-stored cursor;
it never completes tests, finalizes artifacts, releases capacity or deletes outputs.
prune(key) removes <=100 ACKed records atomically, updating accounting and bounded
per-source expiry watermarks. cursor_expired includes a valid snapshot in the
JournalError.recovery property; missing history must remain incomplete.

Single worker/connection owns EXCLUSIVE SQLite locking, WAL/FULL, foreign keys,
100ms busy timeout and 2 MiB cache. Transactional migrations002/003 preserve
offers, IDs, cancel, events, ACK and pruned-source markers; migration003 rebuilds
parent/child tables with foreign keys enabled and adds private admission metadata.
Migration004 adds a per-attempt supervision clock. Additive migration005 stores
bounded optional projections without replaying history during startup. Unpublished
pre-v5 rows retain original events/cursors/charges; unbackfilled phase/exit/result
are UNKNOWN, never proof of absence or complete historical coverage. New installs
and v5 restarts preserve projections across event pruning.
`supervision({key,now,cancel?})` is private trusted-supervisor input: scoped generation,
integer wall milliseconds, optional true cancel. It atomically stores clock high-water,
sticky rollback fencing, first cancellation time and cancellation/queue retirement.
Public durableCancel anchors its first time in the worker's transaction too. A
pre-v4 cancellation has unknown origin (null timestamp), fences supervision and
never earns a new grace period. Clock high-water is at least the persisted admission
clock; observing one attempt does not advance unrelated admission/attempt clocks.
Storage retains the existing admission safe-integer clock domain, even above Date's
range; actual trusted supervision time remains within Date's range. Such inherited
clocks fence timing but must not prevent durable cancellation/queue retirement.
These records survive pruning/ACK/restart and do not release capacity or certify
runtime quiescence. Actors must combine absolute deadlines with local monotonic time;
fenced clocks forbid new dispatch. On clock-integrity failure, emergency termination
is distinct from normal five-second cancellation grace; never claim normal timing.
Future versions refuse open. Startup/commands remain 5 seconds;
queue includes in-flight (default 32/max 64) plus close slot. Unknown commit outcome
requires reconcile after reopen. close awaits exit; abort terminates pending work.
Scoped checks (NODE_OPTIONS=--max-old-space-size=1024):
`npx --no-install vitest run agent/test/journal --maxWorkers=2`
`npm run typecheck`; `npx --no-install eslint agent/src/journal agent/test/journal`
