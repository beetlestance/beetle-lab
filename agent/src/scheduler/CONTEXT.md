# Scheduler boundary

Public entrypoint: index.ts. Read docs/design/lld/agent-scheduler.md before changes.
One poll loop rotates the first charged/delivery/queued lane on each pass. Charged
identities retain their existing rotating order. Delivery/queued pages each use
at most min(32,remaining original slots). Delivery cursor/finite through are separate
from queued; only considered pages advance, and completed delivery passes recapture
their upper bound. A full old work map blocks new discovery/dispatch until originals
settle. At most64 originals share one map; there is no additional queue or pool.
No test retry/state, capacity producer, shadow job queue or release authority.
Timeout aborts signals but retains originals and their slots until settlement.
Close stops scheduling and drains original calls, never asserts runtime termination.
Bootstrap still owns installation cancellation/cleanup and journal/server lifetime.
