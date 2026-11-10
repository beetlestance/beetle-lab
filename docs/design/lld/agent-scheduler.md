# Installation scheduling loop

Status: implemented and independently reviewed component;
[local evidence](../../verification/agent-scheduler.md). Actual bootstrap qualification remains.

The scheduler owns discovery and bounded original drive calls. The installation
controller owns admission, preparation, execution and release. Scheduling an identity
never grants a launch or release capability and never retries a test execution.

`createScheduler` takes private journal `scanRunnable`, installation `drive`, a
trusted monotonic clock and bounded timing options. `start` starts one polling loop;
`close` stops discovery, aborts operation signals and waits for original scan/drive
promises. It does not close the installation, journal or HTTP server. Bootstrap
must separately cancel/drain runtimes and handle uncertain cleanup before claiming
clean installation shutdown. Scheduler close alone makes no termination claim.

Each pass rotates its first lane among charged, delivery and queued. Discovery
uses indexed active/debt lanes, never full historical snapshots. Charged recovery
is handed to the existing controller, which reconstructs pins and reconciles rather
than restaging or redispatching claimed work. All charged attempts fit one100-row
page under admission limit64; unexpected continuation fails that pass before
later lanes dispatch. The [delivery closure contract](output-delivery-closure.md)
owns finite-upper debt discovery and three-lane fairness requirements.
Charged iteration rotates by one identity per pass so transient journal queue
saturation cannot repeatedly exclude the same tail. Rotation changes scheduling
order only, never durable admission FIFO or recovery/dispatch authority.

At most64 original drive calls are outstanding, one per exact scoped generation.
No shadow pending-job queue is created. A blocked original keeps its slot after
timeout/abort until it settles. Each call has an absolute monotonic deadline and an abort timer;
aborting never counts as original completion. Two-preparation and two-collection
limits remain owned by the existing components. No overlapping discovery passes.

Delivery and queued discovery each advance one considered page, limited to
min(32,available original slots). Their cursors are independent; delivery also pins
its finite upper until that pass completes. A full old work map prevents new
scans/dispatch until originals settle. Durable admission retains FIFO/promotion
and capacity authority; a deferral is not failure. Already-outstanding identities
are skipped, not invoked concurrently. A whole bounded page is validated/copied
before dispatch; malformed/refused discovery does not consume its position.

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

Acceptance: rotating three-lane discovery, one call per key,64-original bound,
blocked-original retention after abort, paginated queue revisit, scan failure without
following-lane dispatch, shutdown waiting for original work and no calls after close.
Actual Linux execution, capacity observation, output guards and host shutdown need
their own integration evidence.
