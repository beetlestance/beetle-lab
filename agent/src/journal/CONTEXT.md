# Agent journal boundary

`index.ts` exposes the bounded worker protocol. `AdmissionStore` runs policy and
ownership changes inside one immediate transaction; no external I/O occurs there.
Disk hold insertion, immutable original metadata, 512-byte quota charge and compact
counters commit with the reservation and admitted event. Replay adds no charge.
SQL reservation release moves original output AND staging to retained counters once;
the process retirement proof does not prove physical file absence. No refund API exists.
Every live quota includes spool, snapshot, checkpoint, hold, collection, source and delivery
charges. ACK/prune releases event bytes only. Native free disk is independent.

Migration011 preserves bounded original scheduling records and active/released
ownership. Unsafe identity/staging/totals/debt fail upgrade atomically; never enlarge
quotas or infer absent bytes. Admission reads scalar counters,64 active and100 queue
candidates; SQL hold guards remain bounded. Startup readiness is process-local.

Contract: [disk retention](../../../docs/design/lld/disk-retention.md).
Scoped proof: `vitest run agent/test/disk-retention agent/test/admission --maxWorkers=1`.

Migration012 adds immutable collection intents and verified sources with bounded
native/worker JSON reads. Six private source operations share the two large credits.
Per-open epochs fence first failed closure; exact terminal failed replay survives
reopen. Finished release requires its stored source receipt and original evidence.
The controller still owns native file facts and uninterrupted collection lifetime.
Contract: docs/design/lld/output-source-journal.md.
Focused proof: `vitest run agent/test/source-journal --maxWorkers=1`.

Migration013 adds exact immutable source-backed delivery closures and indexed debt.
Close/read share the source originals/credits; only the worker captures last_seq.
Existing source/release owners validate authority; native guards fence late events,
high-water changes and charge forgery. ACK/prune never refund closure metadata.
Delivery discovery captures a finite upper ID and reads indexed released markers,
never source/Offer history. Producer quiescence and scheduler fairness remain callers'
responsibility. Contract: docs/design/lld/output-delivery-closure.md.
Focused proof: `vitest run agent/test/output-delivery --maxWorkers=1`.

Schema021 retains exact runtime/mailbox association before container DELETE, in a
named2048-byte cell inside unchanged C1 capacity. Private client accepts opaque
Docker observations, and worker joins actual failed termination; it is not IO proof
by itself. Contract: docs/design/lld/runtime-association.md.
