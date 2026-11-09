# Input metadata and bounded runner storage

Verified source: `9caa151`, 2026-11-09, local `rewrite/integration`.
Scope: input metadata, immutable revision pins, runner client byte bounds and
journal migration/capacity. No uploaded bytes or complete execution path is claimed.

## Integrated behavior

The [input contract](../design/lld/input-publication.md) now has an actual worker
implementation. One lifecycle row owns progress, publication/deletion intents and
version checks. Shared receipts replay original control intent; each input owns
at most three. Input payload plus64KiB metadata charge is reserved transactionally
against current storage allocation and its single free-space headroom term.
Deletion releases payload once, retaining the charged tombstone. Settings reductions
preserve existing reservations and block new over-budget allocations.

Migration003 preserves prior metadata, backfills indexed historical revision pins,
fences old published declarations for byte verification and marks old staging
declarations failed. Inconsistent references/orphan rows roll back. New pins require
published state; deleting inputs cannot gain pins. The internal trusted advance
port is not exposed as a metadata-only upload API.

[Runner limits](../design/lld/runner-envelopes.md) separate1MiB config from2MiB Offer.
The client changes only Offer request allowance, captures caller restriction once
and retains existing reply/default bounds. Journal migration008 preserves parent,
four child tables, indexes, projections, charges and three sequence high waters.
Two large originals fit inside the existing bounded queue; final immutable operation
classification controls admission before posting. Controls and close retain capacity.
Known pre-issue read refusal defers installation drive/Stager instead of aborting.

## Review and checks

Independent input review cleared lifecycle/quota/receipt/pin behavior and corrected
scoped arguments silently narrowing global recovery. Caller and raw worker now
reject that argument; global paging still reaches both synthetic organisations.
Independent client review found no blocking findings.

Independent SQLite3.45.3 probes compared historical migrations with a literal v7
fixture, upgrades0..7, exact rows/columns/defaults/FKs/indexes, three sequence edge
cases and late SQL/actual disk-full rollback and retry. They passed; this is not
Node24 or native container qualification.

Independent queue review reproduced a mutable-argument classification bypass.
After correction, both changing-kind and reentrant-fill probes retained exactly
two originals and rejected the third. All promises settled after awaited worker
termination; no unknown runtime work was retried. These prove configured count
behavior, not measured RSS or parallel engine stress.

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0 on the source above:

- Generation37/27/6, all three TypeScript projects, lint and architecture796 passed.
- Documentation131 and frontend build passed; the main-chunk size warning remains.
- All2,631 tests passed in239 files,275.39s, one file worker.

Before that combined gate, application storage/paired API integration passed75 tests
in15 files,41.85s, plus type/lint/structural checks at `5803dd3`. Worker correction
tests separately covered orphan rollback, global recovery and final-operation queue
classification. Reviewed file hashes matched all20 input and21 journal paths plus
the14 immutable client review inputs at integration. Environment: Node26.7.0,
macOS arm64. Keep the [functional/stress distinction](../engineering.md#functional-test-resources).

## Remaining work

Input filesystem custody, publication/restart cleanup, binary HTTP and UI remain.
Input accounting alone does not account for every database/revision/output byte or
enforce a physical filesystem quota. No dataset availability is invented.
Private HTTP/catalogue/enqueue/Docker/engine Offer propagation is still incomplete.
Two controller/supervisor launch-path reads need explicit contention handling;
the passing gate does not prove launch intent survives those refusals.
Run/outbox/artifact finalization, complete product surfaces and release qualification
remain; affected images must be rebuilt and qualified after runtime changes.
