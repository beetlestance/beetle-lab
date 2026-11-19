# Application metadata worker

Public entrypoint: `index.ts`; caller supplies `path`, compiled `workerUrl`, explicit
`installation` record and `runtime: {ceilings,execution,observedAtMs,expiresAtMs}|null` source observation.
`openMetadata()` returns one worker owning one exclusive WAL SQLite connection.
`namespaces.execute`, `settings.execute`, `suites`, `inputs`, `runs` and private `dispatch` implement ports.
Public commands verify intent/receipt; dispatch owns separate scan/read/claim/observe transactions.
Domain decisions and original receipt writes commit atomically with public commands.
`get({kind,scope,id})`, `list({kind,scope,limit,cursor?,parentFolderId?})` and
`getSettings(scope)` expose API-derived namespace/settings values.
Settings rows validate UUID/scope/version/value schemas before projection. Identity
reads validate scope/UUID only, preserving receipt replay without policy/runtime.
Folder paths query <=9 ancestors. Subtree evidence uses a bounded iterative walk:
<=10,000 queued/visited nodes, depth<8 edges, indexed remaining-budget+1 child
queries before enqueue (<=10,000 child rows enumerated, including overflow).
Only settings values/overrides persist; domain resolution computes effective views. `updateRuntime(observation|null)` preserves the producer's source timestamp.
runtimeTtlMs defaults to 5000 ms, bounds 1..60000; stale/future/invalid incoming timestamps
are rejected at caller ingress and worker dequeue, preserving fresh state.
Worker reads/decisions treat expired observations and clock rollback as unknown.
Rollback-time updates are discarded; a persistent high-water source-time fence requires a
genuinely later observation before recovery. Queueing never refreshes age.
Settings reductions retain charges; input admission counts payload+64 KiB and one
configured reserve. Private advances require exact versions and trusted byte service.
Queue <=64(default32); suites/readOffer SHARE TWO originals; input 64 KiB/reply 1 MiB;
revision 2 MiB/config 1 MiB, Offer reply 2 MiB+64 KiB with fixed carrier; worker heap<=128 MiB.
SQLite cache 2 MiB/busy 100 ms; startup 5 s, then 5 s without a completed worker reply.
Bounded FIFO bursts can exceed 5 s total while progressing; no mutation retry, except
capacity-wait.ts: settings/export create, once, after a definite capacity refusal and the next observation (<=2 s).
Close drains admitted FIFO work; close/abort await worker termination, including failure paths.
run_pins (migration 033, run-pins/): receipt-first pin/unpin, terminal runs, <=256 per workspace;
triggers fence retention frames, retirement, admitted removal and pinned-run intents; epoch advances.
Migrations are transactional; legacy rows stay unadopted and indexed.\nRun history uses one scoped read snapshot, fixed covering indexes (migration 017),\nlimit+1 time/UUID keys and a strict query-bound cursor; no native/metric reads.
Immutable indexed pins serialize with deletion; tombstones stay charged; counts/shapes: input-metadata.md.
execution_intents: order/identity/profile digest/budget/mode/policy 1 staging scalars.
execution_records: immutable intent/order, charge, bounded snapshot/gen1/outbox custody.
attempt_output_allocations: scoped immutable maximum+65536/version 1; no settlement.
Deferred claim links need record/output/possible delivery together; usage charges input/output once.
Private reserveRunOutput requires a caller transaction; hasUntrackedOwnership uses partial indices, independent of Run state/Offer bytes.
Authoring (031): run_notes own noteVersion+same-transaction note grams; Run reads add note and durable runtime start/exit via run_events_runtime (<=4 rows); revisions stamp savedAt/savedBy. Listing (034): triggers keep suites.latest_* and suite_revision_run_counts; suite-list/ merges per-group index keysets in one read transaction.
Contracts: docs/system/contracts/storage.md#metadata-worker, run-delivery.md#dispatch-storage, outputs-collection.md#storage-accounting (output allocation), authoring.md, suite-listing.md.
