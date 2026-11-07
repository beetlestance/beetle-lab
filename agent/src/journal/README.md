# Journal boundary

Entrypoint `index.ts`: `openJournal({path, queueLimit?, spoolQuotaBytes?, workerUrl?})`.
Node 24 packaging compiles sibling `worker.js`; retain `node:sqlite` in bundling.
Tests compile with pinned tsup into task-owned temporary directories.
`immutableOffer(unknown)` bounds/validates/copies Offer JSON (1 MiB), preserving
original identity text and canonical duplicate equality. Scoped get/read/cancel
and listOpen (100 snapshots) retain offered state; cancel only persists intent.
No admission, runtime, lifecycle transition or result interpretation occurs here.

`appendWrapper(ControlEvent)` retains wrapper seq as wrapperSeq; `appendSupervisor`
accepts `{sourceOrdinal,event}` where event is a source:'agent' draft without seq.
One supervisor owns the ordinal stream per attempt/generation; other producers
feed that owner. `sourceCursors(scopedGeneration)` restores both source high-water
marks after restart. New source ordinals must increase; gaps are allowed. Identical
retained keys dedup; changed reuse conflicts; pruned/older keys return expired_key.
All wire AgentEvent.seq values are assigned by the journal, atomically with the
payload, durable source key, snapshot cursor and charge. Scope text must match.

Envelopes max 64 KiB; readEvents(key,after) yields <=100 records and <=256 KiB,
including batch envelope. Lengths are selected before bounded payload loading.
Default quota 64 MiB per attempt (override 1024..67108864 bytes for new offers only),
charging encoded event + canonical source JSON +256-byte row/index allowance;
max 65536 retained rows. This is accounting, not a physical SQLite disk bound.
Overflow returns quota_exceeded without sequence growth. Supervisor owns response.

acknowledge(Ack) durably advances only the monotonic application-stored cursor;
it never completes tests, finalizes artifacts, releases capacity or deletes outputs.
prune(key) removes <=100 ACKed records atomically, updating accounting and bounded
per-source expiry watermarks. cursor_expired includes a valid snapshot in the
JournalError.recovery property; missing history must remain incomplete.

Single worker/connection owns EXCLUSIVE SQLite locking, WAL/FULL, foreign keys,
100ms busy timeout and 2 MiB cache. Transactional migration002 preserves v1 offers,
IDs and cancel; future versions refuse open. Startup/commands remain 5 seconds;
queue includes in-flight (default 32/max 64) plus close slot. Unknown commit outcome
requires reconcile after reopen. close awaits exit; abort terminates pending work.
Scoped checks (NODE_OPTIONS=--max-old-space-size=1024):
`npx --no-install vitest run agent/test/journal --maxWorkers=2`
`npm run typecheck`; `npx --no-install eslint agent/src/journal agent/test/journal`
