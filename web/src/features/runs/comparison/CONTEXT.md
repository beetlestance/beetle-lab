# Run comparison (Penpot Compare and Compare / Empty)

Public entry: RunComparison({organizationId,workspaceId}), routed with one runs
query parameter containing two through four distinct ordered UUIDs. First run is
baseline. Same-page history contexts supply suite/revision labels only when
run/suite/revision bind to the captured run; no extra metadata requests. Colliding
four-character IDs expand to source prefix+suffix or the full UUID.
No runs parameter shows Compare / Empty with no read; a malformed one
shows Invalid comparison. History selects at most four terminal runs.
Layout: run strip (status, short ID, Baseline badge or Make baseline, which only
reorders the URL), whole-run figures with labelled client deltas from the
baseline (Deltas.tsx: relative %, percentage points, duration; "same" when equal,
nothing when either side is unknown), What was different (revision, profile,
limits, policy, note), one chosen metric per run, recorded evidence in details.
Generated compareRuns owns request/response semantics. Whole-run summaries come
from one exact-ID listRuns row per run (limit 1), read inside the comparison
admission after the catalogue on first catalogue loads only; each run then gets
one getRunMetricOverview and getRunChartHistory. Failures stay explicit gaps.
One baseline catalogue page (100 entries maximum) is retained. Selecting passes
the full RunMetricKey, never a cross-run ordinal. Unknown conditions and limited
configuration path differences are explicit. No configs or secret values.
One module-lifetime ReadAdmission sequences comparison, summaries, catalogue and
every chart across route/session remounts. Render leases hide old snapshots at
once; cleanup retires/aborts tokens and cancels queued waits. API originals keep
admission until they settle. Errors stop automatic reads; retries are manual.
Recorded p95/requests overlays retain each run's <=900 actual source positions and
native-marker-relative time on one scale. Gaps, nulls and zero remain exact; no
phase warping, union-grid fill or extrapolation. Peak requires the same numeric
source as overview (generation/version/hash/manifest/marker), never configured load.
The optional legacy selector still keeps <=1,000 points/1 MiB per run with its own
UTC timestamps and vertical scale; those advanced timelines are not aligned.
Overview supplies p50/p95/p99 histogram estimates, checks invocation ratio and
dropped counts, without pooling estimates or deriving checks from definition verdicts.
Each ready overview is one source; its nulls never backfill from saved summaries.
When it is unavailable, only the existing accepted history scalars can fall back.
Average rate stays average; overflowed relative deltas stay unknown.
Optional firstFailedSlo shows native failure/reading with a matched saved limit;
legacy missing details stay explicit. No regrading, new reads or polling.
Remaining: target runtime overlay and full board acceptance.
Focused checks: compare, selection, history, integration and lifecycle tests here.
