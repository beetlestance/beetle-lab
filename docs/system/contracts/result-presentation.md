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
All retained phases are shown. Details mount on demand; Reload preserves expansion
and reuses the verified report and its existing owner, without polling.

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

Top Report, Artifacts and Diagnostics anchors select the desktop report tab; supported hash deep links select their panel on entry.
Permanent desktop anchors keep native scrolling valid before a panel mounts.
Phone disclosures defer reads, retain state and open addressed anchors; Notes survives resize.
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

## Recorded comparison overlays

One existing chart-history read per selected run shares comparison admission and
retirement. Each reply remains bounded to 900 actual points / 1 MiB; the backend
retains its 3,600-window / 32 MiB archive ceiling. No metric-per-endpoint fanout.
P95, requests, failures and measured active-VU curves keep independent native-marker-relative
coordinates on a common scale; they never fill a union grid, stretch phases or align wall clocks.
Comparison plots are 120 px high; source coordinates, gap flags and default renderer behavior stay unchanged.
Legends use each series' nearest source sample, hide readings outside coverage/across gaps and retain zero.
An overlay cursor denotes requested time, not a new sample.
Peaks require matching numeric generation/version/manifest/artifact/hash/native marker; missing/error/incompatible sources stay unknown.
Downsampling, partial coverage and missing peak/source notes stay visible; healthy window counts use source details.

## Target comparison overlays

Configured sampling adds one scoped sealed-result read and one sole target report
per run, sequentially within the existing comparison original. Disabled sampling
adds neither. The existing shared two-original byte reader verifies exact length,
SHA-256 and the 1 MiB / 256-sample codec; retirement retains unsettled originals.
The native marker must belong to the exact numeric artifact ID/hash in that sealed
result. Unsafe chronology, duplicate target timestamps or missing timing cannot
enter an overlay. Same metric keys and compatible declared units share a scale;
raw units and different runtime metrics never mix. Zeros/nulls/source positions
remain exact. Links expose individual-run evidence when an overlay is unavailable.
No polling or new API contract; errors and limited/missed collection stay visible. Healthy source identities use details.

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
The headline uses the table's recorded p95 estimates. Missing, zero-baseline and overflowing percentages stay explicit;
subpercent differences are never called unchanged. It infers neither statistical confidence nor a native verdict.

## Ownership

The backend owns this projection. The browser consumes only the generated DTO; it must
not pool percentile estimates or treat excluded endpoint rows as the entire run.
Numeric hash and manifest bind ready source identity; restored history reads it without starting work, mutation or polling.

## Anchors

| Source | SHA-256 |
| --- | --- |
| `web/src/features/runs/comparison/Headline.tsx` | `79e1062ea90d` |
| `app/src/application/run-metrics/overview.ts` | `d32759ade40d` |
| `contracts/api/v2/run-metric-overview.schema.json` | `dfde37122018` |
| `contracts/src/api/metric-overview.ts` | `4217eaad4700` |
| `web/src/features/runs/result/Overview.tsx` | `db6adc16cee5` |
| `web/src/features/runs/result/useResultReads.ts` | `38c36f18eee5` |
| `app/src/application/run-metrics/chart-history.ts` | `8c4d276be252` |
| `app/src/application/run-metrics/scan.ts` | `66af9695701f` |
| `contracts/api/v2/run-chart-history.schema.json` | `a6611d151c82` |
| `contracts/src/api/run-chart-history.ts` | `760adceea5f8` |
| `web/src/features/runs/result/RecordedCharts.tsx` | `f2c47a6eb6d2` |
| `web/src/features/runs/result/chart-model.ts` | `1887a2817681` |
| `web/src/features/runs/charts/` | `7df1caa86595` |
| `web/src/features/runs/result/TargetReport.tsx` | `22e1bba2d75c` |
| `web/src/features/runs/result/target-model.ts` | `193b67abb66f` |
| `web/src/features/runs/result/phase-model.ts` | `b3b5a1aa96af` |
| `web/src/features/runs/result/TargetPhases.tsx` | `1839f3f70683` |
| `web/src/features/runs/result/ReportTabs.tsx` | `8ca6f4c10bae` |
| `web/src/features/runs/comparison/useComparison.ts` | `af8b670d2b12` |
| `web/src/features/runs/comparison/figures.ts` | `8277b45c90aa` |
| `web/src/features/runs/comparison/SettingsTable.tsx` | `pending` |
| `web/src/features/runs/comparison/comparison.css` | `79854448ac21` |
| `web/src/features/runs/comparison/Deltas.tsx` | `dbc528249b35` |
| `web/src/features/runs/comparison/run-labels.ts` | `d1fb5aa96bdd` |
| `web/src/features/runs/comparison/SourceNotes.tsx` | `0c63fd55d953` |
| `web/src/features/runs/comparison/RecordedCharts.tsx` | `f6d13f3d74a3` |
| `web/src/features/runs/comparison/overlay-model.ts` | `ca773531ae9e` |
| `web/src/features/runs/comparison/recorded-source.ts` | `0f579314884f` |
| `web/src/features/runs/live/LiveChart.tsx` | `651a2449b402` |
| `app/src/application/run-comparison/failed-slo.ts` | `6e0a7894448f` |
| `app/src/application/run-comparison/serialize.ts` | `0afc9d598903` |
| `contracts/api/v2/run-comparison.schema.json` | `894f2795a40b` |
| `contracts/src/api/client/comparison-facts.ts` | `3aced93caa5b` |
| `web/src/features/runs/comparison/FailedSlos.tsx` | `642283e7f56d` |
| `web/src/features/runs/comparison/target-read.ts` | `8f7dda58498c` |
| `web/src/features/runs/comparison/target-model.ts` | `fcd94018f94f` |
| `web/src/features/runs/comparison/TargetRuntime.tsx` | `689024e21952` |
| `contracts/src/api/client/comparison-slos.ts` | `3c600533e0c0` |
| `web/src/features/runs/comparison/Slos.tsx` | `e66be0ef3b34` |
| `app/src/application/run-comparison/scenario-intent.ts` | `0839eff70b09` |
| `contracts/src/api/client/comparison-plan.ts` | `622f46677a3a` |
| `web/src/features/runs/comparison/scenario-intent.ts` | `8911ac4e106b` |
| `app/src/adapters/outbound/sqlite/run-reads.ts` | `b72b1b69b123` |
| `web/src/features/runs/comparison/Advanced.tsx` | `76c8a8aa6442` |
| `web/src/features/runs/comparison/index.tsx` | `eff581df8467` |
