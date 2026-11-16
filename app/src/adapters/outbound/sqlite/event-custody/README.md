# Event custody

Public entrypoint: `index.ts` exposes the synchronous EventCustody worker owner and
private RPC capture functions. Metadata.events implements the asynchronous port.
Inputs/replies bind the original retained execution, generation and journal UUID.

Ingest captures the original batch independently of its fixed carrier, validates
with domain/events, and preflights canonical overlap and the immutable allocation.
One immediate transaction appends only a contiguous suffix; schema007 triggers
advance the counters. Compact successful replies are serialized before COMMIT.
Expected quota/replay blockage persists first evidence without partial event rows.
Unknown SQL/serialization failures propagate as unavailable; no ACK is sent here.

Scan uses the pending-obligation index, limit+1 rows and installation/lane-bound
keyset cursors with a captured upper position. Event rows are never pruned here.
There is no network, Run projection, lifecycle finalization or output settlement.
Metadata close fences new originals and drains issued commands in worker FIFO.

Bounds: batch100/262144 bytes, record66048 bytes, control/state4096 bytes,
page65536 bytes, scan32, cursor1024 bytes. Retained rows<=65536 and retained
control bytes<=min(original payload allowance,64MiB), without another usage charge.

Scoped check: `vitest run app/test/storage/events --maxWorkers=1`.
