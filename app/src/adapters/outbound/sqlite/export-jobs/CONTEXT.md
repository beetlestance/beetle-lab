# Export job metadata

Public index exposes jobs/claim/observation/output owners. Wire-only parent entry
is ../export-wire.ts. Metadata migration 015 is separate from agent Journal 015.
Store owns receipt-first transactions; export intent/full original/input pins are
immutable and separate from Run rows. Shared order and resource/storage accounting
reserve 3 MiB metadata and payload before possible delivery. Unknown stays charged.

Compact controls avoid loading full test configuration while polling. Exact-source
adoption and native publication settle backend payload only. Matching authenticated
absence has separate custody; no fabricated source or Run. SQL guards independently
require stopped/released matching evidence before source adoption/credit release.
Latest revision reads use migration 035 index by immutable acceptance order,
never UUID/time order or workspace page scans; scoped existence reads omit config.
Input pins, metadata and agent producer/source lifetime remain retained. No native
paths, IO, remote ACK or producer-purge authority are exposed by these operations.

Checks: app/test/exports. Spec: docs/system/contracts/exports.md.
