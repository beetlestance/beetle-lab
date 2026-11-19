# Run result (Penpot "Run result" boards)

Public entry: `RunResultView({run, scope, runId})`, chosen once by RunDetail for a
terminal/restored record; owns RunReads admission. Restored unfinished state stays labelled at backup; no current-work owners mount,
and run/artifact/metric/timeline polling stops. Stored state and outcome stay exact.
Reads (useResultReads), each under the scoped run key and removed on unmount:
engine result for the active attempt, the run's own history summary (one listRuns
row by exact ID, limit 1), suite, saved revision and getRunMetricOverview. The
overview shares read admission and never polls; errors retire cached figures.
Read-only/restored state comes from useSessionAccess, never a new session read.
- headline.ts: variant (passed, failed, not judged, cancelled, out of memory,
  output full, incomplete, errored, pending) and the title and sentence. Sentence
  figures use stored summary/native SLO readings and matched pinned limits.
  Discovery triggers never become headline SLO failures. Unknowns stay unknown.
- ResultHeader: page h1, status, Refresh run (from RunDetail), Run again (createRun
  with the run's revision, profile, budget and policy), Pin, Delete run. ResultContext
  reads namespace names only; suite/revision/engine/start time use accepted records. Read-only
  sessions hide writes; Refresh run and published downloads remain available.
- ResultDownloads: metadata only on open, at most two pages/128 files, one
  manifest. Native UUID links only; errors hide links. Script opens its saved revision.
- usePin: pinRun/unpinRun from the receipt only, never optimistic; toast, then
  re-reads the run and history pages. pin_limit and cleanup_in_progress explained.
- RunNote: setRunNote with expectedNoteVersion; conflict re-reads the run.
- useWrite: single-flight write, identical replay only on an unknown outcome.
- Overview: five pooled summary tiles and a <=64-row endpoint table, p95 order,
  name filter, explicit missing values/omissions. Histogram estimates stay labelled.
- Sections: fallback history tiles, exact native threshold readings with verified
  pinned limits (no histogram substitution), native verdicts and script version.
- ReportTabs: Report, What happened, Artifacts, Diagnostics; under 760px the tabs
  become a section list (Phone / Run result).
- DeleteRun: dialog composing retention's RetentionControls; a pinned run offers
  Unpin first.
RecordedCharts reads workload history once; peak binds to the summary source.
ResultTargetReport shares one verified report across four cards and lazy details.
Declared groups normalize; incomplete units remain raw. Source gaps/nulls/zero stay
exact; only safe native chronology shares hover. ?target=phases keeps the same
reader for observed phase comparisons; missing phase GC maxima stay unavailable.
ResultCompare: 20 candidates/page, suite/all, verified names/ordinals, no row reads;
the chosen candidate is the baseline.
Checks: npx vitest run web/src/features/runs/result web/src/features/runs/detail.test.tsx
