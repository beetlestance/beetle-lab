# Current live attempt binding

Pure shared capture for latest-window and active-history reads. Query snapshots
accept only scoped run/attempt IDs and normalize UUIDs. Execution snapshots bind
the exact run, workspace and active attempt, require active uncancelled work and
capture the physical EventBinding. Callers read and compare it before/after IO.
This module neither reads metadata nor grants dispatch, result or release authority.
Focused checks: app/test/run-live-metrics and app/test/run-live-history.
