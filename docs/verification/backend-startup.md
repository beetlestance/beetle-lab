# Executable backend capacity connection

Status: locally verified startup, resource publication and shutdown. This is not
completed execution delivery or release qualification.
Owning contracts: [connection](../design/lld/backend-connection.md),
[polling](../design/lld/runtime-polling.md) and
[source leases](../design/lld/capacity-wire.md).

## Exact source

Polling and rollback-refusal correction:
`30cc65a5539b7ab1c2e7916efe45fa55330b878c`.
Final executable startup:
`d015f59b93cf02e8e5a1d86623877aa17efe0d55`.
The coordinator verified that its integration merge has an identical source tree.
Following evidence-document changes do not alter that runtime.

Normal startup requires the installation settings file, private agent configuration
and canonical private data root. The application captures the connection, profile
registry and filesystem paths before awaiting, starts metadata with unknown
capacity, and composes the actual Node gateway, pinned backend disk source and
single-original publication loop. Publication diagnostic status grants no dispatch
permission; SQLite independently checks original expiry and ordering.

Repeated unknown periods do not advance revocation on every poll. Expired/refused
facts are explicit refusals. Clock rollback revokes capacity and refuses nonnull
updates; acknowledging a null revocation does not acknowledge a known fact.
Shutdown fences session access, drains source/publication and gateway originals,
then closes metadata. The same failure propagated through two close paths retains
its original identity; distinct failures still aggregate.

## Reproductions and checks

Independent source reviews covered polling and executable composition. Review
found a rollback acknowledgement mismatch and a path reread after metadata startup.
Both were reproduced and corrected. Real SQLite-worker tests cover queued source
expiry, bootstrap fences, unknown coalescing and recovery after rollback. Actual
HTTP/filesystem tests mutate the caller's path during startup and verify storage
stays under the captured root. A stalled agent request is aborted and drained by
server.close; no subsequent polling request is issued.

The first full startup candidate had3,495 passes and one failure: the unchanged
input-shutdown oracle required the original error, while duplicate propagation
produced an AggregateError. The correction deduplicates only identical error
objects and preserves distinct causes. The existing input-shutdown assertions and all test deadlines were preserved.
Focused corrected startup scope passed36 tests in7 files,11.16 seconds, exit0.

At d015f59, the command
`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0:
3,499 tests in335 files,447.03 seconds. It also passed41 runner/35 API/6 k6
reproducible-output checks, all three TypeScript targets, lint, architecture1,031,
documentation164 and frontend build. The previously timed-out literal8MiB upload
case passed with its original size, assertions and10-second deadline. The existing
609.69kB frontend main-chunk warning remains.

At the same source, `npm run build:api`, `smoke:api` and
`smoke:input-controls` exited0. The compiled tests load required private agent
files, preserve unknown-capacity behavior through an explicit unavailable HTTP
fixture, exercise pairing/input interruption/replay, and exit cleanly on SIGTERM.
Positive startup tests use an authenticated synthetic capabilities peer, native
backend statfs and the actual SQLite worker. No real credential or target is used.
Bundles target Node24; local execution used Node26.7.0 on macOS arm64.

## Remaining first-release work

Fresh capacity and accepted enqueue do not establish delivery or execution.
Durable claim/possible-delivery, exact Offer recovery, matched ACK/projection,
cancellation/event replay and result/artifact finalization remain. Reports,
comparison/export, run UI and required job observability still need completion.
No current Docker/native k6, image/Compose, amd64/arm64, resource/soak, supply-chain
or release qualification is established by this local startup gate.
