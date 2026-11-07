# Supervisor launch boundary

`index.ts` exposes Supervisor and actor launch/reconcile/tick/cancel steps plus
fixed SupervisorError codes. One trusted composition owns the exclusively locked
Journal, installation identity, staged/validated genuine RuntimePlan and manager.
Runner wire contracts are unchanged. Narrow ports retain Journal/Docker signatures.
Each actor gets a fresh DockerBackend from backendFactory; <=64 live actors,
coalesced operations, no work queue. Retire refuses any in-flight lane and closes
old handles permanently. Durable journal claims remain authoritative after eviction.
UUID spelling stays exact for journal access; normalized manager collisions reject
alternate spelling/spec rather than sharing distinct journal ownership.

Journal reservation/offer/plan identity is checked before effects. Create claim
precedes ensureCreated; exact runtime binding and durable clock/cancel reread
precede the sole start claim. Only fresh grants dispatch. Replayed claims inspect
only, including missing runtimes. Cancel fences synchronously, persists on a separate
lane during held launch, then signals only after create/start resolves. Delayed
callbacks cannot revive a grant. Journal failures close local launch permission.

supervision stores first cancel time, high-water and sticky clock fencing. Request
issuance anchors local monotonic timeout/grace ceilings; journal response latency
consumes that budget. Absolute timeout is admittedAt+budget.timeoutMs. Five-second
grace never resets across cancels/recovery. clock_integrity reports emergency timing
uncertainty separately and may kill immediately after durable cancellation. Inherited
fenced clocks never enter normal timing/date arithmetic. Invalid monotonic clocks
can prevent backend requests; unknown remains charged for operator reconciliation.

Runtime observations append to the supervisor ordinal stream before settlement;
known create binds runtime ID durably. completed requires both local backend actions
known and their one-shot capabilities consumed. retired means local start never
sent after a known create. Unknown action/recovery stays unknown regardless of later
stopped/absent samples. Exit codes/OOM are observations, never a test outcome.
No collection, capacity release, deletion, wrapper events or output guard is supplied.

Composition must call tick at least every100ms while active, and continue explicit
reconciliation after step errors. Backend calls are capped at30s (launch also by
remaining execution budget); a step can await a bounded backend request. Scheduler
cadence and this actor do not replace the missing independent wrapper wall deadline
or bounded output writer. Do not advertise timeout/output guard capability here.
Tests: NODE_OPTIONS=--max-old-space-size=1024 npx --no-install vitest run agent/test/supervisor --maxWorkers=2
