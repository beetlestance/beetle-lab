# Supervisor launch boundary

`index.ts` exposes Supervisor and actor launch/reconcile/tick/cancel steps plus
fixed SupervisorError codes. One trusted composition owns the exclusively locked
Journal, installation identity, staged/validated genuine RuntimePlan and manager.
Runner wire contracts are unchanged. Narrow ports retain Journal/Docker signatures.
Each actor gets a fresh DockerBackend from backendFactory; <=64 live actors,
coalesced operations, no work queue. Retirement refuses every outstanding lane and
fences old handles. Durable claims remain authoritative after manager eviction.
Journal UUID spelling stays exact; normalized manager collisions reject changed
spelling/spec rather than sharing distinct journal ownership.

Reservation/offer/plan identity is checked before effects. Create claim precedes
ensureCreated; exact runtime binding and durable clock/cancel reread precede the
sole start claim. Only fresh grants dispatch. Replay inspects, including missing
runtimes. Cancel fences synchronously and persists independently during held launch;
signals wait for create/start resolution. Delayed callbacks cannot revive a grant.
Final dispatch atomically samples clock permission and constructs its operation;
any detected fault/deadline blocks launch. Journal failures close local grants.

Durable first cancel/high-water plus request-issued monotonic ceilings bound timeout
and grace. Absolute timeout is admittedAt+budget.timeoutMs; five-second grace never
resets across cancels/recovery. clock_integrity exposes emergency timing uncertainty
separately and may kill after durable cancellation. Fenced inherited clocks never
enter normal timing/date arithmetic. Invalid monotonic time can prevent requests;
unknown remains charged for reconciliation. No guard capability is advertised.

Runtime events use the supervisor ordinal stream before settlement. A known create
binds its ID durably. completed also requires the actual captured known start
observation durably recorded and all local dispatch capabilities consumed. Failed
evidence retains one exact event/ordinal plus the captured start for bounded retry;
unknown/latest inspector data cannot replace that proof. retired means local start
never sent after a known create. Uncertain actions/recovery remain unknown despite
later stopped/absent observations. Exit0/137 and OOM never establish test outcome.

Composition must call tick every100ms while active, including after step failures.
Backend calls cap at30s; launch also uses remaining execution budget. These bounded
steps do not replace the missing independent wrapper wall deadline/output writer.
No collection, release, deletion, wrapper events or output guard is supplied.
Tests: NODE_OPTIONS=--max-old-space-size=1024 npx --no-install vitest run agent/test/supervisor --maxWorkers=2
