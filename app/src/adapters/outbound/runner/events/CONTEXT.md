# Event attempt transport

Public entry: `collectEvents({store,attempt,signal,stopped}, binding)`.
Runs one load and either pending ACK recovery or one GET/ingest/ACK turn. Uses the
existing installation gateway and pure domain event batch owner. No timers,
discovery, lifecycle projection, finalization or output accounting effects.

Only committed unblocked prefixes authorize ACK. Matched scoped negative replies
may record missing/expired evidence; remote uncertainty and sequence gaps return
fairly. Invalid positive or store replies and thrown storage failures propagate.
Methods and immutable binding are captured before foreign awaits. Received positive
batches retain their original ingestion decision after stop; positive issued ACKs
retain confirmation custody. Stop fences every later network issuance.

Bounds: one batch, 100 records/262144 bytes, compact state4096 bytes; pure owner
validates event identities, ordering and canonical record bounds. No event backlog.

Check: `vitest run app/test/event-delivery --maxWorkers=1` from repository root.
Authority: `docs/design/lld/event-custody.md`, `app/src/ports/events.ts`.
