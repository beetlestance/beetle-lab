# Journal boundary

Public entrypoint: `index.ts`, `openJournal({path, queueLimit?, workerUrl?})`.
Packaging must compile `worker.ts` as the sibling `worker.js` entrypoint;
tests inject a task-owned compiled worker URL. Runtime target is Node 24.
Bundling must preserve `node:sqlite` (tsup `removeNodeProtocol: false`).

`immutableOffer(unknown)` bounds/validates/copies protocol Offer JSON, then records
generation 1, offered state and sequence 0. Complete canonical JSON equality checks
duplicates, including scope and digest. No reference resolution or secret hashing.
This records identity; it neither admits capacity nor launches execution.

`get`, `readOffer` and `durableCancel` require all three scope/attempt UUIDs.
Keys use the public UUID validator, preserving accepted URN/case representations.
Cancel persists intent, without advancing lifecycle or inventing exit evidence.
`listOpen({limit,cursor?})` returns at most 100 snapshots and a numeric next cursor;
all rows in this foundation are offered/open. Lists never read config columns.
Offer reads are at most 1 MiB; JSON additionally uses the public encoder's limits.

One worker and one connection own the DB. Migration 001 is agent-only.
EXCLUSIVE locking is acquired before WAL, retained between short transactions,
and released by OS handle cleanup after crash. Future schema versions refuse open.
WAL, FULL synchronization, foreign keys, 100 ms busy timeout and 2 MiB cache apply.

The queue includes in-flight work (default 32, maximum 64), plus a close slot.
Commands time out after 5 seconds: pending callers fail with typed availability,
and the worker terminates. Such a mutation has unknown commit outcome; reconcile
the same immutable intent after reopen. Public errors contain only fixed codes.
`close()` awaits worker exit on success/failure before preserving its typed result;
it drains FIFO commands; `abort()` explicitly fails
pending work and terminates. No cancellation signal is delivered to any engine.

Scoped checks (heap 1024 MiB, max 2 test workers):
`npx --no-install vitest run agent/test/journal --maxWorkers=2`
`npm run typecheck`
`npx --no-install eslint agent/src/journal agent/test/journal`
Tests compile only the worker using pinned tsup into their own temporary directory.
