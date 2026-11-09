# Application metadata worker

Public entrypoint: `index.ts`; caller supplies `path`, compiled `workerUrl`, explicit
`installation` record and `runtime: {ceilings,observedAtMs}|null` source observation.
`openMetadata()` returns one worker owning one exclusive WAL SQLite connection.
`namespaces.execute`, `settings.execute` and `suites` implement accepted ports.
Each mutation verifies real SHA256 intent, checks receipt first, reads evidence,
calls the domain decision and writes result/receipt in one immediate transaction.
Fresh create allocations never replace original replay IDs or workspace root.
`get({kind,scope,id})`, `list({kind,scope,limit,cursor?,parentFolderId?})` and
`getSettings(scope)` expose API-derived namespace/settings values.
Internal `getSettingsIdentity(scope)` reads only persisted UUID/scope, without
effective/runtime resolution; PATCH can replay receipts after capacity expires.
Scope must match entity kind; folder lists page the whole workspace by default;
optional parentFolderId selects only that parent's children, with distinct cursors.
Lists sort canonical lowercase IDs; <=100 items and query-bound opaque cursors.
Folder paths query <=9 ancestors. Subtree evidence uses a bounded iterative walk:
<=10,000 queued/visited nodes, depth<8 edges, indexed remaining-budget+1 child
queries before enqueue (<=10,000 child rows enumerated, including overflow).
Larger/corrupt trees fail; indexed list queries fetch <=101 rows.
Only settings values/overrides persist; domain resolution computes effective views.
`updateRuntime(observation|null)` preserves the producer's source timestamp.
runtimeTtlMs defaults to 5000 ms, bounds 1..60000; stale/future/invalid incoming
timestamps are rejected at caller ingress and worker dequeue, preserving fresh state.
Worker reads/decisions treat expired observations and clock rollback as unknown.
Rollback-time updates are discarded; a persistent high-water source-time fence
requires a genuinely later observation before recovery. Queueing never refreshes age.
Fresh updates recover unknown capacity. Age validation
does not prove source honesty or capability provenance; receipt replay stays original.
Settings changes preserve the domain admission drain signal; no jobs are killed.
UUID case folds to lowercase; UUID URNs remain distinct from bare UUIDs.
Queue <=64 (default32), suite pending<=2, input64KiB/reply1MiB by default;
full revision command/reply2MiB with config1MiB; worker heap<=128MiB.
SQLite cache2MiB/busy100ms; startup/command availability deadline5s.
Close drains admitted FIFO work; close/abort await worker termination, including
failure paths. Unknown outcomes never trigger automatic mutation retries.
Static `StorageError` codes expose no database paths, SQL or submitted values.
Migrations001/002 are transactional; refuse future schemas; workspace roots immutable.
Suite/revision and published-input pin rules: docs/design/lld/suite-authoring.md.
Check: `npx --no-install vitest run app/test/storage --maxWorkers=2`.
