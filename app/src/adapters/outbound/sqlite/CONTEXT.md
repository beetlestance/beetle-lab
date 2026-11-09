# Application metadata worker

Public entrypoint: `index.ts`; caller supplies `path`, compiled `workerUrl`, explicit
`installation` record and `runtime: {ceilings,execution,observedAtMs,expiresAtMs}|null` source observation.
`openMetadata()` returns one worker owning one exclusive WAL SQLite connection.
`namespaces.execute`, `settings.execute`, `suites`, `inputs` and `runs` implement ports.
Each mutation verifies real SHA256 intent, checks receipt first, reads evidence,
calls the domain decision and writes result/receipt in one immediate transaction.
`get({kind,scope,id})`, `list({kind,scope,limit,cursor?,parentFolderId?})` and
`getSettings(scope)` expose API-derived namespace/settings values.
Internal `getSettingsIdentity(scope)` reads only persisted UUID/scope, without
effective/runtime resolution; PATCH can replay receipts after capacity expires.
Folder paths query <=9 ancestors. Subtree evidence uses a bounded iterative walk:
<=10,000 queued/visited nodes, depth<8 edges, indexed remaining-budget+1 child
queries before enqueue (<=10,000 child rows enumerated, including overflow).
Only settings values/overrides persist; domain resolution computes effective views.
`updateRuntime(observation|null)` preserves the producer's source timestamp.
runtimeTtlMs defaults to 5000 ms, bounds 1..60000; stale/future/invalid incoming
timestamps are rejected at caller ingress and worker dequeue, preserving fresh state.
Worker reads/decisions treat expired observations and clock rollback as unknown.
Rollback-time updates are discarded; a persistent high-water source-time fence
requires a genuinely later observation before recovery. Queueing never refreshes age.
Settings reductions retain charges; input admission counts payload+64KiB and one
configured reserve. Private advances require exact versions and trusted byte service.
Queue <=64 (default32), suite pending<=2, input64KiB/reply1MiB by default;
full revision command/reply2MiB with config1MiB; worker heap<=128MiB.
SQLite cache2MiB/busy100ms; startup/command availability deadline5s.
Close drains admitted FIFO work; close/abort await worker termination, including
failure paths. Unknown outcomes never trigger automatic mutation retries.
Migrations001..005 are transactional; legacy rows stay unadopted and indexed.
Immutable indexed revision pins serialize with deletion; tombstone metadata stays charged.
execution_intents: order/identity/profile digest/budget/mode/policy1 staging scalars.
execution_records: immutable intent/order, charge, bounded snapshot/gen1/outbox custody.
attempt_output_allocations: scoped immutable maximum+65536/version1; no settlement.
Deferred claim links require record/output/possible delivery together; shared usage
charges input/output once. Private reserveRunOutput requires a caller transaction.
hasUntrackedOwnership uses partial indices, independent of Run state/Offer bytes.
Digest owner: executionRegistryDigest uses prefix+newline+canonical profile bytes.
Contracts: dispatch-storage.md/output-allocation.md. Storage fixtures prove no load.
Check: `node node_modules/vitest/vitest.mjs run app/test/storage --maxWorkers=1`.
