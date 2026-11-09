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
State, outcome and validation are independent. Metrics/artifacts are unavailable.
Focused checks: `node node_modules/vitest/vitest.mjs run web/src/features/runs
--maxWorkers=1` (use repository root executable when this worktree lacks deps).
