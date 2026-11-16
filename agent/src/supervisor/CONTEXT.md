# Supervisor launch boundary

Public Supervisor/LaunchActor own launch, reconcile, cancel, retirement and reads.
One trusted composition owns the locked Journal, installation, genuine RuntimePlan
and manager. Fresh backend per actor; <=64 actors, coalesced operations, no queue.
Normalized identity collisions reject changed spelling/spec; durable claims survive
manager eviction. Retirement fences old handles and refuses pending originals. Controller-owned
retirement awaits actual cached telemetry closes before removing an actor.

Reservation/Offer/plan binding validates before effects. Create claim precedes
ensureCreated; exact runtime binding and durable clock/cancel reread precede the
sole start claim. Only fresh grants dispatch. Replay inspects, never restarts.
Cancel fences synchronously; signals wait for create/start resolution. Delayed
callbacks cannot revive grants. Journal uncertainty permanently closes grants.

Durable first cancel/high-water and monotonic ceilings bound timeout and grace.
Timeout=admittedAt+budget; five-second grace never resets across cancel/recovery.
Clock-integrity faults fence dispatch and may kill after durable cancellation.
Unknown stays charged; exit codes/OOM do not establish test outcome or release.

One evidence owner retains four first lifecycle facts, one exact issued resource
append and one coalesced latest summary. Unknown append replays frozen intent.
Lifecycle has priority; exit follows final drained summary. Pending facts block
settlement. Completed requires known local create/start; recovery cannot infer it.

Composition ticks every100ms, including after failures. Backend calls cap30s and
launch consumes remaining execution time. Resource/live telemetry share two
original slots. Resource cadence is1s reads/5s publication; live reads cap5s.
Installed bootstrap requires resource capability and drains before Journal close.
readLiveMetrics uses an existing running actor only, never creates or launches.
Installed policy approves once after Offer/reservation validation; rejection is
advisory. Close/retire retain mailbox originals; cancellation/exit fence replies.

Tests: vitest run agent/test/supervisor; live reader: agent/test/live-metrics.
