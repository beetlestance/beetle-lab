# Plan: run pinning

Status: proposed. Approved in principle (2026-11-17); not built. The Penpot
screens label pinning "Planned" until the storage, API and retention changes
below ship. Today `pinned` exists only as a declared retention protection; no
durable pin record exists.

## Behaviour

| Area | Rule |
| --- | --- |
| Who | The administrator, from the run result header or a Runs list row |
| What | A terminal run (finished, cancelled or errored). Every nonterminal run (queued, dispatching, active, finalizing) cannot be pinned; it is already protected as `active` |
| Limit | 256 pinned runs per workspace; the 257th pin is refused with `pin_limit` |
| Retention | A pinned run is excluded with reason `pinned`. It still counts toward the completed-count and storage figures, so pinning can make a budget unreachable; the preview says so |
| Manual delete | Refused with `protected_dependency` (reason `pinned`); the dialog offers Unpin first |
| Workspace retire | Pins are kept with the retained rows and come back if the workspace is restored |
| Restored history | The pin state at backup time is shown read-only; no toggle |

## Storage and API

- Table `run_pins(organization_id, workspace_id, run_id PRIMARY KEY, pinned_at,
  request_id)`; foreign key to `runs`; partial count enforced in the same
  transaction as the insert.
- `POST …/runs/{runId}/pin` and `POST …/runs/{runId}/unpin` with
  `{scope, requestId}`. Both are idempotent; a replayed `requestId` returns the
  first receipt. Pinning a pinned run or unpinning an unpinned one is a no-op
  success.
- `Run.pinned: boolean` and `Run.pinnedAt?: string` on reads; Runs list filter
  `pinned=true`.
- Pin and unpin advance the workspace retention epoch. An outstanding preview is
  then stale and Apply returns `conflict`; the user previews again.
- Pin and unpin serialize with removal admission in one write transaction. A
  pin that commits first excludes the run from admission; a run already admitted
  for removal is not pinnable (`conflict`, reason `cleanup_in_progress`). Unpin
  never admits removal by itself.
- Apply rechecks protection for every candidate inside its admission
  transaction, independently of the epoch. A stale preview is feedback for the
  user, not the safety mechanism.

## Interface states

| State | Display |
| --- | --- |
| Unpinned | Outline pin button "Pin" |
| Pending | Button disabled with a spinner; the badge is not shown until the receipt returns (no optimistic pin, because retention depends on it) |
| Pinned | Filled pin, label "Pinned", badge on the run header and list row |
| Unpin pending | Spinner; the badge stays until the receipt returns |
| Limit | Inline error under the button: "256 runs are pinned in this workspace. Unpin one to pin this run." with a link to the pinned filter |
| Conflict / unavailable | Inline error with Retry; the state shown is re-read from the server |
| Not pinnable | Button hidden for every nonterminal state, including finalizing; disabled with reason once removal is admitted |

## Evidence

Migration test from the previous schema; API tests for limit, idempotency,
replay, epoch advance and delete refusal; a retention test that a pinned run is
never a candidate; a viewer test that history renders `pinned` without a write
path.
