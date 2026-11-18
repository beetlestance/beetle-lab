# Result metric presentation

## Read contract

`getRunMetricOverview` reuses the verified numeric source and the existing one-read
admission. It returns pooled latency histograms projected to percentile estimates,
native HTTP counts/rates, execute assertion pass counts and dropped iterations.
Missing counters/duration stay null; request rate uses the measured test duration.
At most 64 endpoint rows are returned, ordered by request ordinal, with an explicit
omitted count. Pooled totals include every admitted request, not just returned rows.
It never scans windows or derives a peak from a configured load. Scope, attempt,
source coverage, ratio/rate semantics and a 128 KiB response cap bind the reply.
The result UI reads once per entry through shared read admission, never polls,
and hides cached numeric figures after a read error. It renders pooled tiles and
a p95-ordered endpoint table with a bounded name filter and explicit omissions.

Native threshold values/limits: [reading contract](threshold-readings.md).

## Ownership

The backend owns this projection. The browser consumes only the generated DTO; it must
not pool percentile estimates or treat excluded endpoint rows as the entire run.
Ready source identity includes the numeric artifact hash and manifest; restored
history can read it without starting work. No mutation or current-work polling.

## Anchors

| Source | SHA-256 |
| --- | --- |
| `app/src/application/run-metrics/overview.ts` | `9a665e39c059` |
| `contracts/api/v2/run-metric-overview.schema.json` | `dfde37122018` |
| `contracts/src/api/metric-overview.ts` | `4217eaad4700` |
| `web/src/features/runs/result/Overview.tsx` | `60ccdb6036ab` |
| `web/src/features/runs/result/useResultReads.ts` | `474ff2bb4a8d` |
