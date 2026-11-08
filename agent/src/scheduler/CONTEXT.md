# Scheduler boundary

Public entrypoint: index.ts. Read docs/design/lld/agent-scheduler.md before changes.
One poll loop; charged discovery before one queued page limited to available slots.
At most64 original drives; never advance past undispatched queued identities.
No test retry/state, capacity producer, shadow job queue or release authority.
Timeout aborts signals but retains originals and their slots until settlement.
Close stops scheduling and drains original calls, never asserts runtime termination.
Bootstrap still owns installation cancellation/cleanup and journal/server lifetime.
