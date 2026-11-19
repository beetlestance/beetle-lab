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

## Recorded charts

`getRunChartHistory` uses one full-SHA archive pass in the existing metric-read
lane. It returns at most 900 actual source windows, evenly selected with both
endpoints preserved, pooled HTTP percentile estimates, request/failure counts and
actual VU gauges. Missing readings remain null; gaps remain explicit.
Observed peak request rate and known-request-window count use every scanned
window, including windows omitted from the plot. This is recorded one-second
traffic, not a configured rate or an instantaneous peak guarantee.
Limits stay 3,600 windows, 32 MiB data and 64 request labels; larger sources return
`too_large` with no points. Replies are at most 1 MiB / 65,536 JSON nodes.
Scope/attempt/source, deterministic ordinals, chronology, gap flags and peak bounds
are checked on both sides. The result UI consumes this read once per entry; no
automatic polling, reconnect refetch or per-series fanout. Its five plots share one
hover, preserve source gaps and signed native time, and expose explicit retry.
Peak tiles bind to the same numeric hash/manifest/marker as the summary. Per-series
browsing remains an explicit advanced action.

## Recorded target charts

Four cards share one verified target report and its 256-sample / 1 MiB bounds.
Compatible declared groups normalize to MB, %, ms and counts; any missing unit
keeps that whole group raw, with source labels and a self-comparison warning.
Nulls, zeros, ordinal gaps and duplicate/rollback timestamps stay explicit.
Unplottable UTC observations are counted and retained in advanced source details.
Native marker time shares workload hover only with safe target chronology;
otherwise target cards use their own cursor and disclose the available time origin.
Hover outside coverage or within gaps never substitutes a nearby reading.
All retained phases are shown. Advanced details mount on demand and reuse the
same verified report; no second byte read or automatic polling is introduced.

## Target phase comparison

`?target=phases` keeps the same verified report reader while showing a memory plot
and ten recorded-phase rows. Before/after gauges use the first before and last
after observations, including missing endpoints. During is the arithmetic mean of
known gauge readings, never a time-weighted mean. The source sampler phases can
include engine startup; they do not promise first/last-request boundaries or a
steady baseline. Shaded regions cover only observed before/after spans.
GC rate, time share and average pause require declared cumulative count/time units,
two usable phase endpoints and ordered, reset-free observations. Their intervals
stay within each recorded phase. Missing endpoints/units, overflow and positive
underflow produce unknowns, never zero. Lifetime GC maximum/average readings are
not substituted for phase-local data; the phase-local maximum remains unavailable.
Methods and original observations stay inspectable without a second artifact read.

## Report navigation

Top Report, Artifacts and Diagnostics anchors select the same desktop report tab
as the lower tab bar; supported hash deep links select their panel on entry.
Permanent desktop anchors keep native scrolling valid before a panel mounts.
Phone views retain separate report sections and their actual anchors. Navigation
adds no reader of its own; selected feature owners retain their existing admission,
publication, retry and retirement rules.

## Ownership

The backend owns this projection. The browser consumes only the generated DTO; it must
not pool percentile estimates or treat excluded endpoint rows as the entire run.
Ready source identity includes the numeric artifact hash and manifest; restored
history can read it without starting work. No mutation or current-work polling.

## Anchors

| Source | SHA-256 |
| --- | --- |
| `app/src/application/run-metrics/overview.ts` | `d32759ade40d` |
| `contracts/api/v2/run-metric-overview.schema.json` | `dfde37122018` |
| `contracts/src/api/metric-overview.ts` | `4217eaad4700` |
| `web/src/features/runs/result/Overview.tsx` | `1ad78be84714` |
| `web/src/features/runs/result/useResultReads.ts` | `38c36f18eee5` |
| `app/src/application/run-metrics/chart-history.ts` | `8c4d276be252` |
| `app/src/application/run-metrics/scan.ts` | `66af9695701f` |
| `contracts/api/v2/run-chart-history.schema.json` | `a6611d151c82` |
| `contracts/src/api/run-chart-history.ts` | `760adceea5f8` |
| `web/src/features/runs/result/RecordedCharts.tsx` | `2e8b3ab203f4` |
| `web/src/features/runs/result/chart-model.ts` | `52b2e65dd3d8` |
| `web/src/features/runs/charts/` | `7df1caa86595` |
| `web/src/features/runs/result/TargetReport.tsx` | `750bc555e4bb` |
| `web/src/features/runs/result/target-model.ts` | `193b67abb66f` |
| `web/src/features/runs/result/phase-model.ts` | `b3b5a1aa96af` |
| `web/src/features/runs/result/TargetPhases.tsx` | `1839f3f70683` |
| `web/src/features/runs/result/ReportTabs.tsx` | `3e23e074426e` |
