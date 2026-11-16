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
Entry completion leases retain public drive/cancel/stop/cancelOriginal cleanup.
Retirement fences new producers and excludes only its actual drive caller, drains
other leases, preparation/watch originals and the final cancellation chain before
cached native close. Metadata closure retries reuse that completion and exact source
receipt. Unknown/quota outcomes retain the fenced owner; serialized drives reconcile
stored closure before replay. Source-backed late cancellation writes metadata only.
Producer-free late callers finish all leases, fence and validate the exact existing
closure before owner eviction; absence/uncertainty retains reconciliation ownership.
Private guard/timeout stops run under the drive lease; issued service callbacks stay
owned by cached watch closes before the final cancellation chain is captured.
Source-free rejected/released debt uses the same native barrier before Scope-only
Journal closure; no owner is evicted while required closure remains pending.
Cold settled debt additionally drains/fences the Supervisor actor and performs a
read-only exact stopped-runtime inspection; it emits no events or late stop cause.
Unknown inspection/native close stays unresolved; metadata retries retain completion.
Contracts: `docs/design/lld/output-{delivery-closure,absence}.md`,
`docs/design/lld/installation-controller.md` and `types.ts`.
Focused checks: installation tests and affected Node typecheck.
