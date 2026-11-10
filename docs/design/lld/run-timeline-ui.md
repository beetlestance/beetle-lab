# Execution timeline UI

Status: accepted frontend implementation contract. Uses the integrated
[finite event API](run-event-reads.md). No SSE or metric-chart claim.

## Surface and ownership

Run detail includes an accessible Execution activity section, using the existing
app tokens, borders, typography and reduced-motion rules. Keep layout stable and
compact, with a manual refresh control. Use plain labels for admission, phases,
progress, cancellation, native exit, collection and reported resource summaries.
Do not dump event JSON, private runtime IDs or filesystem paths into the product.

A single generated API client and query cache own reads. The query-key registry
owns runEvents(organisation,workspace,run,attempt), nested beneath the run key.
One keyed timeline instance owns its requested namespace/run/active attempt and
retires on navigation, logout, session change or attempt replacement.

Project events into display rows; keep at most 100 rows and 64 KiB of serialized
row data, evicting oldest rows with a visible recent-history notice. Retain no raw
event corpus or page-per-cursor query cache. A single transient API page remains
bounded by the existing 256 KiB wire contract. Rows keep sequence and timestamp;
source timestamps are correlation, not a monotonic elapsed-time measurement.

## Reads and lifetime

Initial read uses limit1 to discover durableThrough. If other events remain, make
at most one further request: for history longer than100, seek to
max(0,durableThrough-100) using the shared cursor helper; otherwise resume normally.
This starts at recent activity without scanning an entire journal. Explain when
earlier activity is omitted.

For subsequent reads use the confirmed resumeCursor with limit100. Deduplicate
sequences; never join scopes or attempts. At most one query operation is issued;
manual refresh must not cancel and overlap an already-issued original. Use AbortSignal
and lifetime checks before/after both possible bootstrap calls. Late callbacks may
settle but cannot issue another request, mutate retired cache or render new scope.

Poll active runs every2s, suspended while hidden; errors stop automatic polling and
show explicit retry. A page with nextCursor is backlog, not a reason for a tight
fetch loop. Continue bounded polling until caught up; preserve recent-history notice
when eviction occurs. Empty caught-up polls preserve rows and progress facts.

An existing read error takes precedence over terminal refresh; only manual retry
restarts reads after that error. On a terminal Run transition, stop ordinary polling, wait for an already-issued
read to settle, then perform one final refresh. If that final read has backlog,
continue bounded draining until caught up or error. A terminal initial mount still
loads recent history. Terminal state never fabricates stream completeness.

## Truthful state

Pending/empty capture, loading, read failure, partial coverage, blocked delivery,
recent-history eviction and normal caught-up state are different messages. Present
the API's coverage/problem and retained-start gap; do not hide stale rows on error.
No heartbeat or repeated completed-unit count advances useful progress. Track the
latest phase and a last-useful-progress timestamp only from phase transitions or
increasing completed units with usefulProgress true, bound to that phase. Never
invent a percentage when a total is unknown/zero.

Engine result events are provisional reports, not a replacement verdict. Existing
Run state/result panel owns final outcomes. Cancellation requested does not mean
stopped; runtime exit does not mean tests passed. Container resource summaries are
reported aggregate CPU time, peak memory/PIDs and output, with units and declared
controls. Absent summaries display not reported; never per-function CPU/RSS claims.

## Acceptance

Test recent bootstrap with <=2 calls for a long history; bounded rows/bytes/query
cache; resume, duplicates, empty polls, partial/blocked coverage and honest progress;
held first/second reads retired by scope/session/attempt/unmount; hidden pause;
terminal refresh racing a held read; errors/manual retry; and reported zero versus
missing resources. Test the integrated Run detail through the generated client.
Use existing UI fixtures/styles and preserve their assertions. Scoped feature tests,
changed lint and web TypeScript suffice; coordinator reviews and checks the changed
composition once. Real-browser and release qualification remain explicitly pending
until performed. No framework/dependency changes, fake chart or unsupported sensor.
