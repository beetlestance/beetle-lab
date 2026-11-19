# Run comparison (Penpot Compare and Compare / Empty)
Public entry: RunComparison({organizationId,workspaceId}), routed with one runs
query parameter containing two through four distinct ordered UUIDs. First run is
baseline. Same-page history contexts supply suite/revision labels only when
run/suite/revision bind to the captured run; no extra metadata requests. Colliding
four-character IDs expand to source prefix+suffix or the full UUID.
Empty selection reads one history page for its workspace name; invalid runs rejects.
Layout: one table owns run headers, eight primary figures and paged native SLOs.
Baseline controls only reorder the URL; client deltas preserve unknowns and zeros.
Additional figures, saved settings and per-series exploration use disclosures; catalogue errors open exploration.
SettingsTable owns the primary revision/executor/rate/VUs/note comparison.
Compact native rows share equal limits in their label; unequal limits stay per cell.
Generated compareRuns owns request/response semantics. Whole-run summaries come
from one exact-ID listRuns row per run (limit 1), read inside the comparison
admission after the catalogue on first catalogue loads only; each run then gets
one getRunMetricOverview and getRunChartHistory. Failures stay explicit gaps.
One catalogue page (<=100 entries); selection uses RunMetricKey, never an ordinal.
Unknown conditions and limited configuration path differences are explicit. Compact intent only; no raw configs or secrets.
One module-lifetime ReadAdmission sequences comparison, summaries, catalogue and
every chart across route/session remounts. Render leases hide old snapshots at
once; cleanup retires/aborts tokens and cancels queued waits. API originals keep
admission until they settle. Errors stop automatic reads; retries are manual. Catalogue failure preserves the
accepted comparison and shows a scoped alert with explicit retry.
Recorded p95/requests/failures/active-VU overlays retain each run's <=900 actual source positions and
native-marker-relative time on one scale. Gaps, nulls and zero remain exact; no
phase warping, union-grid fill or extrapolation. Peak requires the same numeric
source as overview (generation/version/hash/manifest/marker), never configured load.
The optional legacy selector still keeps <=1,000 points/1 MiB per run with its own
UTC timestamps and vertical scale; advanced timelines are unaligned. Expansion survives reads, keyed by scope/selection.
Overview supplies p50/p95/p99 estimates, invocation checks and dropped counts.
Ready overviews never backfill nulls; headline p95 uses the same source as the table.
When it is unavailable, only the existing accepted history scalars can fall back.
Average rate stays average; overflowed deltas stay unknown. Native firstFailedSlo
shows failure/reading with a matched saved limit;
legacy missing details stay explicit. No regrading, new reads or polling.
Named table scroll regions wrap on phones. Failed refresh retires mutable names.
Configured target reads bind sole sealed descriptors and numeric ID/hash timing.
Shared verified byte admission, same metric/declared units; no raw-unit overlay.
120px plots retain source timing/gaps; healthy provenance uses details, uncertainty stays visible. Full family acceptance
remains open. Checks: comparison, target-runtime, history and lifecycle tests.
