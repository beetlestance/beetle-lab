# Run result (Penpot "Run result" boards)
Public entry: `RunResultView({run, scope, runId})`, chosen once by RunDetail for a
terminal/restored record; owns RunReads admission. Restored unfinished state stays labelled at backup; no current-work owners mount,
and run/artifact/metric/timeline polling stops. Stored state and outcome stay exact.
Reads (useResultReads), each under the scoped run key and removed on unmount:
active-attempt result, own exact-ID history summary (listRuns, limit 1), suite, saved revision and getRunMetricOverview.
The overview shares admission, never polls and retires cached figures after errors.
ResultReadProblem explicitly retries result details; pending retry keeps its disabled control.
Read-only/restored state comes from useSessionAccess, never a new session read.
- headline.ts: variant (passed, failed, not judged, cancelled, out of memory,
  output full, incomplete, errored, pending) and the title and sentence. Sentence
  figures use a ready overview or indexed fallback, plus native SLOs/pinned limits.
  Ready nulls never borrow index figures; discovery triggers never become SLO failures.
- ResultHeader: title, status, Refresh run, Run again with the saved run settings,
  Pin and Delete. On phones, More actions holds Refresh and Delete. ResultContext
  reads namespace names only; suite, revision, engine and times use accepted records. Read-only
  sessions hide writes; Refresh run and published downloads remain available.
- ResultDownloads: metadata only on open, at most two pages/128 files, one
  manifest. Native UUID links only; errors hide links. Script opens its saved revision.
- PinControl is shared by result/header and history; hides unfinished writes, restored badge only.
- usePin: pinRun/unpinRun from the receipt only, never optimistic; toast, then
  re-reads the run and history pages. pin_limit and cleanup_in_progress explained.
- RunNote: frozen edit version, recorded noteUpdatedAt; useRunNote owns receipt replay,
  useNoteConflict owns scoped refresh and explicit conflict choices, including clears.
  useWrite is single-flight, with identical replay only on unknown outcomes.
- Overview: five desktop/four phone tiles; expandable facts; <=64 endpoints, p95 order,
  name filter, explicit missing values/omissions. Histogram estimates stay labelled.
- Sections: fallback history tiles, exact native threshold readings with verified
  pinned limits (no histogram substitution), native verdicts and script version.
- What happened: recorded milestones and source-bound native rise; source clocks stay separate.
- ReportTabs: one selected desktop tab shared with top section links; permanent
  anchors target Report/Artifacts/Diagnostics. Phone panels defer first mount, then retain
  visited state; stable Notes survives resize. Phase mode keeps target/Back visible.
- DeleteRun: RetentionControls dialog; a pinned run offers Unpin first.
RecordedCharts reads history once; peak binds to summary. ResultTargetReport shares
one verified report across four cards and lazy details; reload preserves expansion.
Declared groups normalize; incomplete units remain raw. Source gaps/nulls/zero stay
exact; only safe native chronology shares hover. ?target=phases shares that reader
and shows HTTP landmarks separately; missing phase GC maxima stay unavailable.
ResultCompare: 20 candidates/page, suite/all, verified names/ordinals, no row reads; chosen candidate is baseline.
