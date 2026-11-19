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

## Comparison figures

Comparison reads one bounded overview per selected terminal run (two to four),
sequentially with the existing exact-ID history reads under the same original
admission. Retirement hides the old view and prevents peer work; an ignored abort
never refunds physical admission before the API original settles. No polling.
Ready overviews supply their own complete figure set: p50/p95/p99 estimates,
request/failure/check values and dropped iterations. Missing fields remain unknown;
no history field fills a ready overview's null. Without a ready overview, existing
accepted history scalars can remain, with a per-run error/availability note.
Existing exact-ID history responses also supply bound suite/revision metadata.
Only the captured run/suite/revision match can grant a comparison label; missing
or mismatched records remain unknown. All metadata shares the same scoped owner.
Selected IDs with colliding four-character prefixes expand to prefix plus suffix,
then the complete source UUID if needed; labels never invent a run ordinal.
Phone comparison tables keep readable row/column widths inside named keyboard-
focusable scroll regions, while run cards wrap their controls.
Rates stay labelled whole-run averages; no peak is invented from the configured
load. Differences describe scalar observations, not statistical confidence.

## Native comparison failures

The optional first failed SLO detail reuses captured sealed results and the pinned,
validated revision. It includes its native reading and a uniquely matched saved
limit, never the full config or secret values. Missing readings and mismatched
metric/statistic limits remain explicit. Discovery triggers are not SLO failures.
The client rejects detail with zero failed count or contradictory reading/limit
identity. Display never reevaluates the native verdict. The unchanged 256 KiB
reply cap may omit this optional detail; no additional reads or polling are added.

## Recorded comparison overlays

One existing chart-history read per selected run shares comparison admission and
retirement. Each reply remains bounded to 900 actual points / 1 MiB; the backend
retains its 3,600-window / 32 MiB archive ceiling. No metric-per-endpoint fanout.
P95, requests, failures and measured active-VU curves keep independent native-
marker-relative coordinates on a
common scale; they never fill a union grid, stretch phases or align wall clocks.
The shared renderer accepts optional per-series source coordinates and gap flags.
Its default shared-timeline behavior stays unchanged. Recorded legends use each
series' own nearest source position, hide values outside coverage/across gaps,
and retain known zero. An overlay cursor denotes requested time, not a new sample.
Observed peaks require matching overview numeric generation, version, manifest,
artifact/hash and native marker. Missing/error/incompatible sources leave unknowns.
The chart notes preserve downsampling and partial-coverage context.

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
| `web/src/features/runs/result/chart-model.ts` | `1887a2817681` |
| `web/src/features/runs/charts/` | `7df1caa86595` |
| `web/src/features/runs/result/TargetReport.tsx` | `750bc555e4bb` |
| `web/src/features/runs/result/target-model.ts` | `193b67abb66f` |
| `web/src/features/runs/result/phase-model.ts` | `b3b5a1aa96af` |
| `web/src/features/runs/result/TargetPhases.tsx` | `1839f3f70683` |
| `web/src/features/runs/result/ReportTabs.tsx` | `3e23e074426e` |
| `web/src/features/runs/comparison/useComparison.ts` | `812decb44ba1` |
| `web/src/features/runs/comparison/figures.ts` | `8277b45c90aa` |
| `web/src/features/runs/comparison/Deltas.tsx` | `3d3b4ae2f47c` |
| `web/src/features/runs/comparison/run-labels.ts` | `d1fb5aa96bdd` |
| `web/src/features/runs/comparison/RecordedCharts.tsx` | `fe6f0666d203` |
| `web/src/features/runs/comparison/overlay-model.ts` | `ca773531ae9e` |
| `web/src/features/runs/comparison/recorded-source.ts` | `0f579314884f` |
| `web/src/features/runs/live/LiveChart.tsx` | `e6a093baddd7` |
| `app/src/application/run-comparison/failed-slo.ts` | `97247eae9563` |
| `app/src/application/run-comparison/serialize.ts` | `39be8f46032f` |
| `contracts/api/v2/run-comparison.schema.json` | `6cc1977118f0` |
| `contracts/src/api/client/comparison-facts.ts` | `b555242c9534` |
| `web/src/features/runs/comparison/FailedSlos.tsx` | `642283e7f56d` |
