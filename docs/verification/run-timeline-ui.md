# Execution activity UI

Status: locally implemented and independently reviewed. Contract:
[run timeline](../design/lld/run-timeline-ui.md).
Integrated implementation: `f380890`, based on `6cdda6c` and the integrated public
[event reader](run-event-reads.md).

Run detail shows recent phase activity, useful progress, reported resources and
coverage/problems. A single scoped attempt query retains projected rows, capped at
100 rows/64 KiB serialized data. Long histories require at most two bootstrap reads;
subsequent reads resume a confirmed cursor. No raw event corpus is cached/rendered.

Active polling uses two-second intervals and pauses while hidden. Errors retain
recent data and stop automatic reads. Scope/session/attempt/unmount retirement
fences both possible bootstrap calls. Terminal transitions wait for an issued read
and refresh once, with bounded backlog draining; an existing error requires manual
retry. Engine reports remain provisional; Run/result own final verdicts.

## Evidence

Coordinator checked all 14 submitted source hashes, production logic, projected
payloads, fixtures and failure oracles. Worker independently reviewed the
coordinator-authored UI contract/query identity before implementation.

Focused timeline checks passed 25 tests in 4.26s. Affected run composition checks
passed 45 tests in 8.00s before the final timeline-only refinements. Changed lint
and web TypeScript passed. Coordinator's integrated run composition passed 5 tests
in 2.15s; architecture checked 1,616 source files.

Tests use the generated API client and cover cursor resume, long-history seeking,
row/cache bounds, empty polls, coverage/errors, useful versus repeated/heartbeat
progress, phase finish, terminal races and held first/second read retirement.
Existing run tests retain their original operation counts; only event calls are
excluded from those unrelated counts. Earlier timer/fixture/lint/type failures
remain in private evidence.

Styling reuses existing project tokens and global reduced-motion rules. The labelled
scroll list is keyboard-focusable. No assets, themes or dependencies changed.

## Limits

Evidence is source/DOM based; no browser control tool was exposed in this session,
so real-browser layout/accessibility and release qualification remain pending.
Resource display is tested synthetically. The current agent does not emit
resource.summary, so real per-attempt CPU/RAM/PID observation is unfinished and the
UI defaults to Not reported. No SSE, metric charts or native image claim is made.
