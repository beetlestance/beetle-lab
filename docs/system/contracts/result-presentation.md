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
and hides cached figures after an error. The HTTP route group holds two request lifetimes.
The UI renders pooled tiles and a p95-ordered endpoint table with bounded filtering and explicit omissions.

Native threshold values/limits: [reading contract](threshold-readings.md).

## Recorded charts

`getRunChartHistory` uses one full-SHA archive pass in the existing metric-read
lane. It returns at most 900 actual source windows, evenly selected with both
endpoints preserved, pooled HTTP percentile estimates, request/failure counts and
actual VU gauges. Missing readings remain null; gaps remain explicit.
Peak rates and known-window counts scan every source window, including those omitted from the plot.
`meanVus` averages all one-second latest native VU readings, not continuous busy time.
Gaps, missing VUs, partial coverage or unsafe arithmetic leave the mean null; peaks never represent configured load.
Limits stay 3,600 windows, 32 MiB data and 64 request labels; larger sources return
`too_large` with no points. Replies are at most 1 MiB / 65,536 JSON nodes.
Scope/attempt/source, deterministic ordinals, chronology, gap flags and peak bounds
are checked on both sides. The result UI consumes this read once per entry; no
automatic polling, reconnect refetch or per-series fanout. Its five plots share one
hover, preserve source gaps and signed native time, and expose explicit retry.
Peak tiles bind to the same numeric hash/manifest/marker as the summary. Per-series
browsing remains an explicit advanced action.
Stopped runs with an accepted archive and a known longer saved plan show the
remaining plan time as blank. The chart labels the last recorded window and the
end specified by the revision. Hover beyond observed data has no reading.

When a stopped run has no published archive, Results can chart
[recovered observations](result-frame.md#recovered-observations) without deriving
whole-run metrics or verdicts.

## Recorded target charts

Four cards share one verified target report and its 256-sample / 1 MiB bounds.
Compatible declared groups normalize to MB, %, ms and counts; any missing unit
keeps that whole group raw, with source labels and a self-comparison warning.
Nulls, zeros, ordinal gaps and duplicate/rollback timestamps stay explicit.
Unplottable UTC observations are counted and retained in advanced source details.
Native marker time shares workload hover only with safe target chronology;
otherwise target cards use their own cursor and disclose the available time origin.
Hover outside coverage or within gaps never substitutes a nearby reading.
All retained phases are shown. Details mount on demand; Reload preserves expansion
and reuses the verified report and its existing owner, without polling.

## Target phase comparison

`?target=phases` keeps the same verified report reader while showing a memory plot
and ten recorded-phase rows. Before/after gauges use the first before and last
after observations, including missing endpoints. During is the arithmetic mean of
known gauge readings, never a time-weighted mean. The source sampler phases can
include engine startup; they do not promise first/last-request boundaries or a
steady baseline. Shading covers only observed before/after spans. Sealed k6
request landmarks appear as separate UTC times below the chart when available.
The cooldown memory comparison uses the first before and last after points.
It requires declared memory units and ordered observations without a visible reset.
GC rate, time share and average pause require declared cumulative count/time units,
two usable phase endpoints and ordered, reset-free observations. Their intervals
stay within each recorded phase. Missing endpoints/units, overflow and positive
underflow produce unknowns, never zero. Lifetime GC maximum/average readings are
not substituted for phase-local data. A complete reported pause sequence supplies
the phase-local maximum between its recorded endpoints.
Methods and original observations stay inspectable without a second artifact read.

## Report navigation

Top Report, Artifacts and Diagnostics anchors select the desktop report tab; supported hash deep links select their panel on entry.
Permanent desktop anchors keep native scrolling valid before a panel mounts.
The first chart read waits for the overview to settle. Retry remains explicit. Phone panels defer reads, retain state and open addressed anchors. Notes survives resize.
Navigation adds no reader of its own; selected feature owners retain their existing admission,
publication, retry and retirement rules.

See [recorded milestones](result-milestones.md) for What happened; [result frame](result-frame.md) covers headlines and navigation.

## Comparison figures

Comparison reads one bounded overview per selected terminal run (two to four),
sequentially with the existing exact-ID history reads under the same original
admission. Retirement hides the old view and prevents peer work; an ignored abort
never refunds admission before the API original settles. A catalogue refusal keeps accepted
comparison facts and offers explicit catalogue retry; there is no polling.
Ready overviews supply their own complete figure set: p50/p95/p99 estimates,
request/failure/check values and dropped iterations. Missing fields remain unknown;
no history field fills a ready overview's null. Without a ready overview, existing
accepted history scalars can remain, with a per-run error/availability note.
Exact-ID history contexts label the captured suite and saved revision; full digests remain in fingerprints.
Only matching run/suite/revision identities grant labels. Missing or mismatched metadata stays unknown.
All metadata shares the same scoped owner. Equal display labels never imply equal revision identities.
Colliding four-character IDs expand to prefix plus suffix, then the full UUID; labels never invent ordinals.
Phone comparison tables keep readable row/column widths inside named keyboard-
focusable scroll regions; header controls remain bound to their run.
Rates are whole-run averages, not configured peaks. Deltas describe observations, not statistical confidence.

One table combines run headers, eight measurements and native thresholds; header controls only reorder the URL.
Additional whole-run figures retains averages/totals/check counts. Equal native limits share a row label;
otherwise each cell displays its own limit.

## Native SLO comparison

Optional SLO rows (at most 256 per run) and first failure detail reuse captured sealed results
and the pinned, validated revision. It includes its native reading and a uniquely matched saved
limit, never the full config or secret values. Missing readings and mismatched
metric/statistic limits remain explicit. Discovery triggers are not SLO failures.
The client rejects detail with zero failed count or contradictory reading/limit
identity. Full rows also bind unique IDs, failed count and any first-failure detail.
Display never reevaluates native verdicts. The 256 KiB reply cap may omit both optional projections together; no additional reads or polling are added.
The UI bounds the union to 1,024 IDs and renders 32 rows per local page. Each cell
keeps its own recorded verdict/metric/value/limit; unavailable legacy evidence and
a rule absent from a recorded set differ. Equal display labels grant no verdict.

## Comparison overlays

[Comparison charts](comparison-charts.md) owns common-scale recorded overlays,
resting legends, target-phase means and source/hover safeguards.

## Configured scenario intent

The existing pinned-config capture supplies optional compact intents for at most
64 scenarios: executor, source-unit initial/maximum arrivals, initial/maximum VUs.
Each staged maximum includes its declared start; no time-unit rescaling or sum
across scenarios is made. Native stage reads stay bounded to 128 per scenario.
This is submitted intent, including rejected allocations, not engine admission,
observed traffic, reservation or concurrent VUs. Client checks reject impossible
projection shapes but preserve explicit contradictory ramp-until limits/allocations.
Only these primitive fields leave the capture; names, targets, data and secrets do
not. The existing two-attempt 256 KiB serializer omits all optional projections on
overflow, including for runs without a native result. Missing legacy intent stays
unknown; the UI never fills it from observed or installed values. No new reads.

## Comparison frame and workspace context

History pages optionally return the workspace name once, from the existing
validated workspace guard inside the same transaction. No extra DB query.
Comparison retains the baseline page name under its session/scope/selection owner.
A failed refresh retires mutable names; explicit retries refresh facts even while
a metric is selected. Pending retries cannot resurrect retired names.
An empty selection resolves its breadcrumb with one history page (limit 1), never
comparison or metric reads. Its illustration is the exported Penpot asset. Figures,
thresholds, workload charts, target charts and configuration follow board order. Advanced
per-series exploration and fingerprints use a disclosure; catalogue errors open it.
Expansion survives reads and resets with the scoped selection; toggling adds no reads.
The headline uses the table's recorded p95 estimates. Missing, zero-baseline and
overflowing percentages stay explicit. Small differences stay distinct from equality,
and rounding preserves the distinction between exact and near-100% changes.
A single complete peer failure can share its headline; other failures retain their evidence list.

## Ownership

The backend owns this projection. The browser consumes only the generated DTO; it must
not pool percentile estimates or treat excluded endpoint rows as the entire run.
Numeric hash and manifest bind ready source identity; restored history reads it without starting work, mutation or polling.

Run history displays up to 12 sampled one-second execute HTTP p95 estimates from
its existing index summary. Numeric-final v5 carries the points and their gaps.
When fewer than two points are available or the preview exceeds the existing
output allowance, v4 carries the scalar p95. The list adds no metric reads.

## Anchors

| Source | SHA-256 |
| --- | --- |
| `web/src/features/runs/comparison/Headline.tsx` | `67bdbad137b1` |
| `web/src/features/runs/HistoryP95Sparkline.tsx` | `3f3dd9a8639b` |
| `app/src/application/run-metrics/history.ts` | `a91fb64f3a31` |
| `contracts/api/v2/run-history.schema.json` | `4daeaa42000e` |
| `app/src/application/run-metrics/overview.ts` | `d32759ade40d` |
| `contracts/api/v2/run-metric-overview.schema.json` | `dfde37122018` |
| `contracts/src/api/metric-overview.ts` | `4217eaad4700` |
| `web/src/features/runs/result/Overview.tsx` | `26db2d0ef298` |
| `web/src/features/runs/result/useResultReads.ts` | `a7b812def9d6` |
| `app/src/application/run-metrics/chart-history.ts` | `a39d0284a0c4` |
| `app/src/application/run-metrics/scan.ts` | `66af9695701f` |
| `contracts/api/v2/run-chart-history.schema.json` | `03316213a5dd` |
| `contracts/src/api/run-chart-history.ts` | `2dd377350a07` |
| `web/src/features/runs/result/RecordedCharts.tsx` | `5b673f28a315` |
| `web/src/features/runs/result/chart-model.ts` | `7c592a7f4bd7` |
| `web/src/features/runs/charts/` | `326688f9fb02` |
| `web/src/features/runs/result/TargetReport.tsx` | `22e1bba2d75c` |
| `web/src/features/runs/result/target-model.ts` | `a9726ba3526f` |
| `web/src/features/runs/result/phase-model.ts` | `5ff3d54b4aa0` |
| `web/src/features/runs/result/TargetPhases.tsx` | `b6688cca6e5a` |
| `web/src/features/runs/result/ReportTabs.tsx` | `f8c87c408ae2` |
| `web/src/features/runs/comparison/useComparison.ts` | `af8b670d2b12` |
| `web/src/features/runs/comparison/figures.ts` | `8277b45c90aa` |
| `web/src/features/runs/comparison/SettingsTable.tsx` | `pending` |
| `web/src/features/runs/comparison/comparison.css` | `a3242b9d264d` |
| `web/src/features/runs/comparison/Deltas.tsx` | `35a884b1b52f` |
| `web/src/features/runs/comparison/run-labels.ts` | `d1fb5aa96bdd` |
| `web/src/features/runs/comparison/SourceNotes.tsx` | `0c63fd55d953` |
| `web/src/features/runs/comparison/RecordedCharts.tsx` | `3bf347e8f56f` |
| `web/src/features/runs/comparison/overlay-model.ts` | `ca773531ae9e` |
| `web/src/features/runs/comparison/recorded-source.ts` | `04e94c1c9f79` |
| `web/src/features/runs/live/LiveChart.tsx` | `63e4933d8d58` |
| `app/src/application/run-comparison/failed-slo.ts` | `6e0a7894448f` |
| `app/src/application/run-comparison/serialize.ts` | `0afc9d598903` |
| `contracts/api/v2/run-comparison.schema.json` | `894f2795a40b` |
| `contracts/src/api/client/comparison-facts.ts` | `3aced93caa5b` |
| `web/src/features/runs/comparison/FailedSlos.tsx` | `fd572c421024` |
| `web/src/features/runs/comparison/target-read.ts` | `8f7dda58498c` |
| `web/src/features/runs/comparison/target-model.ts` | `69929b3e4eda` |
| `web/src/features/runs/comparison/TargetRuntime.tsx` | `3d842b27be6c` |
| `contracts/src/api/client/comparison-slos.ts` | `3c600533e0c0` |
| `web/src/features/runs/comparison/Slos.tsx` | `404a35b6e3c7` |
| `app/src/application/run-comparison/scenario-intent.ts` | `0839eff70b09` |
| `contracts/src/api/client/comparison-plan.ts` | `622f46677a3a` |
| `web/src/features/runs/comparison/scenario-intent.ts` | `8911ac4e106b` |
| `app/src/adapters/outbound/sqlite/run-reads.ts` | `b72b1b69b123` |
| `web/src/features/runs/comparison/Advanced.tsx` | `76c8a8aa6442` |
| `web/src/features/runs/comparison/index.tsx` | `a69c66318fee` |
