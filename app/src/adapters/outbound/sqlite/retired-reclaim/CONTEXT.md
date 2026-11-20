# Retired namespace reclamation

Entry: OutputDeletions `reclaimRetiredOutputs` (Metadata.outputDeletions.reclaimRetired).
Decision 034; contract docs/system/contracts/namespaces.md.

Runs inside the caller's immediate transaction. It reads at most `limit` (<=32) rows:
workspaces by `workspaces_page` keyset, then Run headers of one retired workspace by
`runs_page`. Eligibility is a set of indexed probes: terminal, no intent, no pin, no
note, exactly one attempt, no export job. It also needs positive custody facts and a
funded cleanup control. Eligible Runs get an ordinary Begin with deterministic deletion
and request IDs derived from the Run ID, so a replay begins nothing new.

Never deletes rows or files and never charges or refunds. Live workspaces are skipped.
Pins keep protecting after retirement. The cursor is a validated position hint only.
Tests: app/test/retired-reclaim/*.test.ts, app/test/output-deletion-runtime/reclaim.test.ts.
