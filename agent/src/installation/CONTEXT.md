# Installation execution composition

`createInstallationController` accepts trusted Journal, Catalog, Supervisor and
preconfigured Stager, output and timeout services. Admission, lifecycle and output evidence remain
owned by those public modules. No timers, scheduler or container deletion lives here.

One installation controller owns each journal and at most 64 generation entries;
64 public operations and two preparations may be outstanding. A generation has one
drive lane. Original preparation result/quiescence, cancellation and controller
close promises stay owned until settled. Failed cleanup retains ownership/charge.

Enqueue accepts only durable queued/replayed intents. Drives admit atomically,
prepare fresh local setup once, or reconstruct exact claimed plans for tick.
Tokenless abandoned setup is aborted without restaging. Released controllers close
before owner eviction. Cancel persists clocked intent before signalling runtime.
cancelOriginal shares structural Offer capture and journal atomic refusal, bypasses
catalogue/staging, and signals owned runtime only after durable commit.
Cancelled controllers continue ticks through collection/release while execution stays fenced.
Effect-free owners retire after settled callers and confirmed uncharged journal state;
operation versions prevent stale probes from evicting a new active lane.
Close fences callbacks, aborts preparation signals and independently drains originals;
the bootstrap retains journal ownership.

Contract: `docs/design/lld/installation-controller.md` and `types.ts`.
Focused checks: `npx vitest run agent/test/installation --maxWorkers=2`;
`npx tsc -p tsconfig.node.json --noEmit`.
