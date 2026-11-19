# Runs
Public entries: `Runs({organizationId, workspaceId, runId?})` and
`RunSavedRevision({revision})`. Only saved revisions launch runs; RunRequester shows captured labels, never current settings.
Generated ApiClient validates requests/responses and scope. History requests exact contextual counts/ranges; uncounted pages stay unknown. Chips, pinned
(runsPage key slot), suite, sort apply at once; search on Enter sends 8+ hex characters as
runIdPrefix, else name (names and notes). Changes reset paging/selection.
History frame/rows use scoped page metadata; failures hide names/counts. Counts cache separately.
HistorySuites reads 100 filter/fallback names; failed reads retire cached names;
History rows expand colliding IDs; the pin column shares receipt-only PinControl.
No row reads are added; restored pins show Pinned at backup; no empty authoring.
Details poll every two seconds while nonterminal, stop on errors/terminal states,
and suspend interval work when hidden. Unmount cancels/removes scoped run queries.
Submission fetches effective settings only after explicit opening; form state
survives background settings changes. One captured body/requestId is retained
for explicit unknown-outcome replay. No automatic mutation retries occur.
Unmount/session retirement aborts and fences original callbacks; abort cannot
prove absence of commit. SessionApp remounts App by authenticated generation.
Accepted receipts invalidate detail/history; receipt version 1 never seeds detail.
State, outcome and validation are independent. Result reads use generated
getRunResult under the scoped run key plus active attempt; retiring that identity
aborts/removes its query. Null remains unavailable; HTTP errors remain explicit.
Results poll while nonterminal and stop on errors/terminal state. A terminal
transition rechecks a previously null source. Only current Run state finalizes
the result panel's provisional label; declarations grant no download authority.
RunDetail owns cancellation above QueryState, retaining intent through read errors.
RunCancellation displays one scoped request ID across unknown reply retries; accepted
intent displays waiting, never terminal stop. Receipt replay invalidates reads;
it cannot overwrite newer detail. Session/scope retirement fences callbacks.
Check: `node node_modules/vitest/vitest.mjs run web/src/features/runs --maxWorkers=1`
ExecutionActivity is composed through timeline/index; it owns one bounded projected
activity query per scoped active attempt. See timeline/CONTEXT.md for read limits,
retirement, useful progress and terminal drain behavior.
RunArtifacts (artifacts/index: bounded inventory, UUID-only downloads) and RunMetrics
(metrics/index: one catalogue, bounded charts) document their reads in their own
CONTEXT.md; result declarations alone still grant no links.
RunReads separates metadata from metrics; each lane owns one original plus four
waiting intents. Waiting expires after five seconds or abort; retirement rejects the queue.
Original completion releases admission. Storage bounds and explicit HTTP errors
remain unchanged; there are no automatic retries or mutation admission changes.
RunDetail dispatches once to live/ (h1, Cancel) or result/ (h1, Refresh run); see both.
