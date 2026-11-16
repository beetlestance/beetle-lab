# Run comparison controls

Public entry: RunComparison({organizationId,workspaceId}), routed with one runs
query parameter containing two through four distinct ordered UUIDs. First run is
baseline. History retains at most four terminal selections in the current scope
and API session, including across bounded history pages.
Generated compareRuns owns request/response semantics. One replacement snapshot
and one baseline catalogue page (100 entries maximum) are retained. Catalogue
pagination replaces options; selecting passes the full RunMetricKey, never a
cross-run ordinal. Result aliases and logical request/assertion bindings remain
visible. Unknown conditions and limited configuration path differences are explicit.
No configs, secret values, compatibility verdict, synthesized zeros or deltas.
One module-lifetime ReadAdmission sequences comparison, catalogue and every chart
across route/session remounts. Render leases hide old snapshots immediately;
cleanup retires/aborts tokens and cancels queued waits. API originals retain
admission until they settle. The generated transport can return before an
ignored underlying fetch settles; this is not a physical-fetch custody guarantee.
Errors stop automatic reads; refresh, catalogue and chart retries are manual.
Metrics public SamplesView reuses bounded projection/UTC chart behavior. At most
four independent charts retain up to1,000 points/1MiB each, ten pages per action.
Sample replies must match source manifest and full selected metric identity.
Each chart has its own source timestamps and scale; timelines are not aligned.
No polling, cumulative run corpus, new outcome/percentile math or mutation.
Focused checks: selection, history, integration and lifecycle tests in this folder.
Actual browser interaction/layout and native source qualification remain separate.
