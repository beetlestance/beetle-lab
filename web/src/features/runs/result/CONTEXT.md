# Run result (Penpot "Run result" boards)

Public entry: `RunResultView({run, scope, runId})`, chosen once by RunDetail for a
terminal run. It wraps its own RunReads admission and owns no polling.

Reads (useResultReads), each under the scoped run key and removed on unmount:
engine result for the active attempt, the run's own history summary (one listRuns
row by exact ID, limit 1), suite, saved revision and the browser session.

- headline.ts: variant (passed, failed, not judged, cancelled, out of memory,
  output full, incomplete, errored, pending) and the title and sentence. Sentence
  figures come only from the stored summary; unknown parts are left out.
- ResultHeader: page h1, status, Refresh run (from RunDetail), Run again (createRun
  with the run's revision, profile, budget and policy), Pin, Delete run. Read-only
  sessions hide every action except Refresh run.
- usePin: pinRun/unpinRun from the receipt only, never optimistic; toast, then
  re-reads the run and history pages. pin_limit and cleanup_in_progress explained.
- RunNote: setRunNote with expectedNoteVersion; conflict re-reads the run.
- useWrite: single-flight write, identical replay only on an unknown outcome.
- Sections: summary tiles, thresholds (pass/fail, id, purpose), script version.
- ReportTabs: Report, What happened, Artifacts, Diagnostics; under 760px the tabs
  become a section list (Phone / Run result).
- DeleteRun: dialog composing retention's RetentionControls; a pinned run offers
  Unpin first.

Not shown because the API has no value: threshold values and limits, p50/p99,
peak rate, checks %, dropped iterations, endpoint table, previous-run delta.

Checks: npx vitest run web/src/features/runs/result web/src/features/runs/detail.test.tsx
