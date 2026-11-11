# Supervisor launch boundary

`index.ts` exposes Supervisor and actor launch/reconcile/tick/cancel steps plus
fixed SupervisorError codes. One trusted composition owns the exclusively locked
Journal, installation identity, staged/validated genuine RuntimePlan and manager.
Wire contracts and Journal/Docker signatures are unchanged. Fresh backend per actor;
<=64 live actors, coalesced operations, no queue. Retirement refuses pending work and
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

One serialized evidence owner retains four first lifecycle facts, one exact issued
resource append and one coalesced latest summary. Unknown append replays its frozen
intent/ordinal; lifecycle takes priority before unissued telemetry. Exit follows the
final drained summary. Lifecycle uncertainty preserves cancellation/error semantics;
telemetry-only failure retains bounded replay. Pending work blocks retirement.
completed requires known local create/start and durable evidence; recovered actors
cannot infer that proof. retired means known create without a sent start. Unknown
stays charged. Exit0/137 and OOM never establish test outcome; no release is inferred.

Composition must call tick every100ms while active, including after step failures.
Backend calls cap at30s; launch also uses remaining execution budget. Telemetry uses
shared two-original admission, 1s reads/5s publication; installed bootstrap requires
its backend capability and drains closeTelemetry before Journal shutdown.
Tests: NODE_OPTIONS=--max-old-space-size=1024 npx --no-install vitest run agent/test/supervisor --maxWorkers=2
