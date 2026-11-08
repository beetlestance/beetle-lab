# Installation scheduling loop

Status: component implementation in progress; actual bootstrap qualification remains.

The scheduler owns discovery and bounded original drive calls. The installation
controller owns admission, preparation, execution and release. Scheduling an identity
never grants a launch or release capability and never retries a test execution.

`createScheduler` takes private journal `scanRunnable`, installation `drive`, a
trusted monotonic clock and bounded timing options. `start` starts one polling loop;
`close` stops discovery, aborts operation signals and waits for original scan/drive
promises. It does not close the installation, journal or HTTP server. Bootstrap
must separately cancel/drain runtimes and handle uncertain cleanup before claiming
clean installation shutdown. Scheduler close alone makes no termination claim.

Each pass scans charged identities before queued identities. Discovery uses the
journal's indexed active lanes, never full historical snapshots. Charged recovery
is handed to the existing controller, which reconstructs pins and reconciles rather
than restaging or redispatching claimed work. All charged attempts fit one100-row
page under the admission limit64; an unexpected continuation fails the pass before
queued dispatch rather than ignoring unknown charged work.
Charged iteration rotates by one identity per pass so transient journal queue
saturation cannot repeatedly exclude the same tail. Rotation changes scheduling
order only, never durable admission FIFO or recovery/dispatch authority.

At most64 original drive calls are outstanding, one per exact scoped generation.
No shadow pending-job queue is created. A blocked original keeps its slot after
timeout/abort until it settles. Each call has an absolute monotonic deadline and an abort timer;
aborting never counts as original completion. Two-preparation and two-collection
limits remain owned by the existing components. No overlapping discovery passes.

Queued discovery advances one page limited to available original-drive slots
(at most64) per pass, restarting from0 after
exhaustion. Durable admission retains FIFO/promotion and capacity authority; a
deferral is not failure. Every pass revisits charged attempts before more queued
work. Already-outstanding identities are skipped, not invoked concurrently.

Default interval250ms (allowed50..5000); operation budget30s (allowed100..300000).
No resource observations or guard freshness are invented by the scheduler. Bootstrap
must supply actual observations through admission; unknown/stale observations retain
their existing rejection/deferral behavior. Optional idle/thermal facts stay unknown
unless a qualified producer supplies them.

Status contains running/closed, outstanding count and a bounded last-error category
(`scan`, `drive`, `clock`). It carries no offer/config, secret or runtime capability.
Background failures remain visible and future passes reconcile durable state; they
must not be presented as passed runs or clean runtime shutdown.
Fair rotation under transient saturation proves eventual service, not a qualified
timeout/output stop latency. A64-job pool sharing a32-command journal can delay
the tail over multiple passes; bootstrap guard freshness/latency must be measured
and may require a separate reserved guard lane before advertising enforcement.

Acceptance: charged-before-queued discovery, one call per key,64-original bound,
blocked-original retention after abort, paginated queue revisit, scan failure without
queued dispatch, shutdown waiting for original work and no calls after close.
Actual Linux execution, capacity observation, output guards and host shutdown need
their own integration evidence.
