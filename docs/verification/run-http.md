# Authenticated run API evidence

Candidate: `8aa2a66`; date2026-11-09, Node26.7.0/macOS arm64.
Scope: authenticated enqueue/detail/history over the accepted SQLite run store.
No agent dispatch, real engine execution or completed result is claimed.

## Implemented boundary

The normal application registers generated createRun/getRun/listRuns operations
behind the existing local session, Host/Origin and CSRF guards. Enqueue bodies
are <=64KiB and must match the route workspace before allocation, clock or store
effects. Application inputs are snapshotted before repository awaits; replies are
validated, scoped and bounded (Run64KiB, pages1MiB/<=requested limit/unique UUIDs).
A queued202 follows store settlement. Exact receipt replay binds original client
intent and retains the original IDs/time, despite fresh allocations for each call.
No automatic retry, engine call, fake empty page or successful execution fallback.

The pure command function moved unchanged to intent.ts behind the same public
entrypoint. Saved-suite and queued-run validation now share one installed k6 schema
instance and the same existing digest/validation semantics. No CPU/RAM improvement
measurement is inferred from that source consolidation.

## Independent review and functional checks

The worker's20 tests, Node TypeScript and scoped lint passed. Its initial isolated
worktree selected ancestor AJV6 instead of the workspace's locked AJV8. Coordinator
references to existing workspace-local packages fixed resolution; no install,
lockfile/config edit or gate relaxation occurred. The original command extraction
was independently compared byte-for-byte before integration.

Independent source reviews found no blocking findings in application/HTTP ownership,
authentication order, bootstrap composition, schema reuse or native fixture oracles.
Composed scoped checks passed22 tests/6 files in5.52s, plus Node TypeScript, scoped
lint, architecture962 and docs151; the later adapter context passed docs152.
The initial unregistered bootstrap tests failed404. The first socket fixture paired
against mismatched configured/listener origins and correctly received403; the
fixture now uses its actual owned origin. Production authentication is unchanged.

## Actual TCP enqueue/restart proof

A synthetic installation supplies explicit programmatic profile pins and runtime
observations. The test uses the shipped typed client over real loopback TCP into
openApplication/Fastify and its compiled SQLite worker, with disposable data.
Namespace, workspace, suite and immutable revision are saved through public API.
The transport consumes and deliberately loses the first run response. An external
assertion requires that response to be202 with a valid Run; client error mapping
cannot swallow this oracle. Exact replay and detail/history return the original run.

The application closes and reopens the same database with empty profile registry
and unknown runtime. A fresh paired session replays the original request unchanged;
a new request gets503 and changed-intent reuse gets409. After closing, independent
SQL reads require exactly one run, attempt and outbox, matching original IDs/receipt,
no assigned generation and no possible delivery. This is queue persistence, not
agent admission. It does not install genuine profile/capacity provenance.

## Integrated gate and compiled compatibility

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0 at `8aa2a66`:
**3,103 tests/304 files in413.77s**, generated contracts, all three TypeScript
projects, lint, architecture962, docs152 and frontend build passed. The existing
bundle-size warning remains; no threshold changed.

The changed backend was built once with `npm run build:api`; `smoke:api` and
`smoke:input-controls` both exited0. The compiled normal entrypoint truthfully
rejects fresh enqueue503 while its installed-profile/capacity bridge is absent,
serves empty run history/scoped404, and retains prior suite/input/session behavior
and clean SIGTERM. The programmatically configured successful TCP test above is
separate from that normal executable compatibility check.

## Required next work

The newer [installed binding report](installed-binding.md) covers exact descriptor
pins, immutable Offer binding and agent recovery fences at its tested source.
Normal private configuration, source-fresh capacity,
durable dispatch/acknowledgment/cancel, event cursors, verified artifact finalization
and run/results UI remain required. No Docker/Compose, native engine architecture,
resource/soak/backup, browser/proxy or release qualification is established here.
