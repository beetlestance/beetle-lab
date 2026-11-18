# Run views

RunDetail owns the scoped run query and cancellation. It selects LiveRunView for
nonterminal runs and RunResultView for terminal entries. A watched run stays in the
live view after termination until Open result remounts and rereads the result.
Headers belong to each view. Route/run/attempt changes remount phase selection.

copy.phaseOf selects waiting, starting, running, cancelling, finalizing and ended.
Waiting/Starting match the early Penpot structure: plain steps, indeterminate bar,
bottom cancellation, exported decorative Starting illustration and skeleton figures.
Queue reads share one scoped query; errors hide cached capacity/holders and expose
retry. Preflight completion needs the verified saved revision; compilation needs
phase.started prepare/execute (validate.finished can also describe failure).
Early steps expose completed/pending state to assistive technology without fake
percentages, request initiators or elapsed-time progress. Installed engine labels
use one scoped status read with exact selector matching and explicit retry.

plan.ts reads the pinned revision's stages, requests and thresholds. Request rN
means index N. model.ts derives one window's figures; pooled latency is unavailable,
so estimates use the slowest endpoint and never average percentiles. Unknown
metric/stat dimensions and unavailable values stay explicit. Missing/future or
browser-unparseable starts do not become zero elapsed time or NaN.

Feed validates Run and binds UUIDs case-insensitively. stream owns feed leases,
pause/retry and latest frame. history merges <=900 actual live/verified recorded
windows; contracts/active-history.md owns bootstrap, sampling and lifetime rules.
Captions state coverage, source gaps break lines and singleton readings remain
visible. Target runtime uses the <=256 page-received samples as reported; it does
not claim full-run coverage or engine resource measurements.

Namespace names use scoped query keys and explicit retry independent of metrics.
Cancellation and restored/read-only access use the existing session context, never
a new session read. Live downloads offer only verified JavaScript revision export;
the picker reads20 summaries plus this run's verified revision, with older history
linked to the suite. Cache/fresh revision reads bind scope, suite, ID and digest.
No automatic export preparation or live report/metrics download. Terminal rise
attribution reads sealed sources. Header/progress/early styles have separate owners.
Tests: ui, model, Phases, backfill, LiveChart and adjacent live-metrics/live-history.
