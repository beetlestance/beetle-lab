# Agent journal boundary

`index.ts` exposes the bounded worker protocol. `AdmissionStore` runs policy and
ownership changes inside one immediate transaction; no external I/O occurs there.
Disk hold insertion, immutable original metadata, 512-byte quota charge and compact
counters commit with the reservation and admitted event. Replay adds no charge.
SQL reservation release moves original output AND staging to retained counters once;
the process retirement proof does not prove physical file absence. No refund API exists.
Every live quota includes spool, snapshot, checkpoint, hold, collection, source and delivery
charges. ACK/prune releases event bytes only. Native free disk is independent.

Migration011 validates at most 4096 bounded original scheduling records and preserves
active and released originals. Unknown identity/staging, unsafe totals and quota debt
fail the entire upgrade with prior schema/data intact. Current pool size is irrelevant
to that conservative upgrade. Recover using the prior binary for cleanup or a
consistent backup; never enlarge quotas, drop originals or infer missing zero bytes.
Normal admission reads only scalar retention counters, 64 active reservations and
100 queue candidates. SQL guards recompute only the bounded hold table.

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
