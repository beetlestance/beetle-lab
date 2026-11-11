# Runs

Public entries: `Runs({organizationId, workspaceId, runId?})` and
`RunSavedRevision({revision})`. Only immutable saved revisions can launch runs.
Generated ApiClient owns request/response validation and scope bindings.
History retains bounded opaque pages through the shared Pagination owner.
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
Focused checks: `node node_modules/vitest/vitest.mjs run web/src/features/runs
--maxWorkers=1` (use repository root executable when this worktree lacks deps).
ExecutionActivity is composed through timeline/index; it owns one bounded projected
activity query per scoped active attempt. See timeline/CONTEXT.md for read limits,
retirement, useful progress and terminal drain behavior.
RunArtifacts is composed through artifacts/index for bounded published inventory
and browser-owned UUID-only downloads. See artifacts/CONTEXT.md for read lifetime,
paging and transfer ownership; result declarations alone still grant no links.
RunMetrics composes sealed history through metrics/index; one catalogue page and
bounded replacement chart views. See metrics/CONTEXT.md for paging and ownership.
