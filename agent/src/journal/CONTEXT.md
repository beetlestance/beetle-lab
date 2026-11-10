# Agent journal boundary

`index.ts` exposes the bounded worker protocol. `AdmissionStore` runs policy and
ownership changes inside one immediate transaction; no external I/O occurs there.
Disk hold insertion, immutable original metadata, 512-byte quota charge and compact
counters commit with the reservation and admitted event. Replay adds no charge.
SQL reservation release moves original output AND staging to retained counters once;
the process retirement proof does not prove physical file absence. No refund API exists.
Every spool, projection and checkpoint quota includes the hold charge; ACK/prune
release event bytes only. Native free disk and logical disk promises are independent.

Migration011 validates at most 4096 bounded original scheduling records and preserves
active and released originals. Unknown identity/staging, unsafe totals and quota debt
fail the entire upgrade with prior schema/data intact. Current pool size is irrelevant
to that conservative upgrade. Recover using the prior binary for cleanup or a
consistent backup; never enlarge quotas, drop originals or infer missing zero bytes.
Normal admission reads only scalar retention counters, 64 active reservations and
100 queue candidates. SQL guards recompute only the bounded hold table.

Contract: [disk retention](../../../docs/design/lld/disk-retention.md).
Scoped proof: `vitest run agent/test/disk-retention agent/test/admission --maxWorkers=1`.
