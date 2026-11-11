# Shared duration metric values

Public entry: @beetle/contracts/metrics. Pure exponential-v1 millisecond values,
fixed64-bucket recording/merge, strict distribution validation and percentile
estimates/bounds. Engine, backend and browser use this one implementation; raw
point parsing, series ownership and source windows remain engine responsibilities.
No Node/framework/engine/IO dependency, clock, cache or result authority.

Counters are safe integers, values finite/nonnegative. Scale4 down to-10, exact
zero/extrema, immutable snapshots and common-scale merge. Percentiles use nearest
rank and outward-rounded bounds; never average percentile values across windows.
Admit bounded JSON before parsing (standalone distribution <=2KiB); object inputs
must be bounded data, not reflective hostile proxies. Validation bounds bucket
iteration before work. Domain errors are explicit, never a measured zero.

Moved byte-for-byte from the independently reviewed engine implementation; do not
fork engine/backend/chart copies. Owning spec: docs/design/lld/k6-distributions.md.
Focused checks: vitest run contracts/test/metrics plus affected engine aggregation.
