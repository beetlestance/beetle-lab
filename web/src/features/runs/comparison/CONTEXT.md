# Run comparison (Penpot Compare and Compare / Empty)

Public entry: RunComparison({organizationId,workspaceId}), routed with one runs
query parameter containing two through four distinct ordered UUIDs. First run is
baseline. No runs parameter shows Compare / Empty with no read; a malformed one
shows Invalid comparison. History selects at most four terminal runs.
Layout: run strip (status, short ID, Baseline badge or Make baseline, which only
reorders the URL), whole-run figures with labelled client deltas from the
baseline (Deltas.tsx: relative %, percentage points, duration; "same" when equal,
nothing when either side is unknown), What was different (revision, profile,
limits, policy, note), one chosen metric per run, recorded evidence in details.
Generated compareRuns owns request/response semantics. Whole-run summaries come
from one exact-ID listRuns row per run (limit 1), read inside the comparison
admission after the catalogue on catalogue loads only; a failed summary is a gap.
One baseline catalogue page (100 entries maximum) is retained. Selecting passes
the full RunMetricKey, never a cross-run ordinal. Unknown conditions and limited
configuration path differences are explicit. No configs or secret values.
One module-lifetime ReadAdmission sequences comparison, summaries, catalogue and
every chart across route/session remounts. Render leases hide old snapshots at
once; cleanup retires/aborts tokens and cancels queued waits. API originals keep
admission until they settle. Errors stop automatic reads; retries are manual.
At most four independent charts keep up to 1,000 points/1 MiB each. Each chart
has its own source timestamps and scale; timelines are not aligned.
Not available from the API: per-threshold values, p50/p99, peak rate, checks %,
dropped iterations, per-run chart overlays on one axis, target runtime overlay.
Focused checks: compare, selection, history, integration and lifecycle tests here.
