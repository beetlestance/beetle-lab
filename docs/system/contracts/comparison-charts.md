# Comparison charts and legend values

## Recorded comparison overlays

One existing chart-history read per selected run shares comparison admission and
retirement. Each reply remains bounded to 900 actual points / 1 MiB; the backend
retains its 3,600-window / 32 MiB archive ceiling. No metric-per-endpoint fanout.
P95, requests, failures and measured active-VU curves keep independent native-marker-relative
coordinates on a common scale; they never fill a union grid, stretch phases or align wall clocks.
Comparison plots are 120 px high; source coordinates and gap flags stay unchanged. Ordinary live charts retain latest-reading defaults.
Resting workload legends use source-bound whole-run requests/second, pooled p95,
failures/second (native failure count / measured duration), and `meanVus` from all
source windows. A retained summary can supply bound recorded scalars only when the
overview is unavailable; a ready overview's nulls are never backfilled. Missing
aggregates never fall back to the last or plotted-window mean.
Hover uses each series' nearest source sample, hides readings outside coverage/across
gaps and retains zero. Fractional means are not rounded into displayed zeroes.
An overlay cursor denotes requested time, not a new sample. Known whole-run figures remain visible when every plotted HTTP reading is null; an explicit empty-plot message replaces axes and lines.
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

## Recorded means

`meanVus` and `knownVusWindows` reuse the same full SHA-verified scan, before at most
900 points are selected. There are at most 3,600 one-second native windows; retaining
at most 3,600 gauge values adds no archive read or polling. The mean uses each window's
latest native [`vus` gauge](https://grafana.com/docs/k6/latest/using-k6/metrics/reference/), not continuous busy time. It requires every
window to have a known reading, complete source coverage and a contiguous span.
Missing inputs, gaps or unsafe arithmetic produce null; known zeroes remain zero.
The client checks known counts and source/span eligibility, and recomputes unsampled
means. For downsampled replies the source-bound aggregate remains a backend assertion.

Resting target legends average recorded `during` observations, then apply their
compatible declared unit conversion. Every during reading must be known; missed,
limited or gapped reports withhold the mean. These are sampler phases, not exact
first/last-request boundaries, and the mean is not time weighted. Missing or unsafe
values remain null. Hover keeps original observations and does not use the mean.

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/application/run-metrics/chart-history.ts` | `a39d0284a0c4` |
| `contracts/api/v2/run-chart-history.schema.json` | `03316213a5dd` |
| `contracts/src/api/run-chart-history.ts` | `2dd377350a07` |
| `web/src/features/runs/live/LiveChart.tsx` | `63e4933d8d58` |
| `web/src/features/runs/comparison/resting-values.ts` | `12e46664550f` |
| `web/src/features/runs/comparison/recorded-source.ts` | `04e94c1c9f79` |
| `web/src/features/runs/comparison/RecordedCharts.tsx` | `be843bdff76a` |
| `web/src/features/runs/comparison/target-model.ts` | `69929b3e4eda` |
| `web/src/features/runs/comparison/TargetRuntime.tsx` | `3d842b27be6c` |
