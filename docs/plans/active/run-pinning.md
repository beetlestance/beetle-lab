# Plan: run pinning

Status: active. Storage, API and retention shipped (migration 033, 2026-11-18);
the web interface below is not built. Shipped behaviour lives in
[run lifecycle](../../system/contracts/run-lifecycle.md#pinning),
[storage](../../system/contracts/storage.md#retention-and-space),
[retention selection](../../system/contracts/outputs-settlement.md#retention-selection)
and [public API](../../system/contracts/public-api.md#run-history). Delete this
plan when the interface ships.

## Remaining: interface

| Area | Rule |
| --- | --- |
| Who | The administrator, from the run result header or a Runs list row |
| What | Only terminal runs show the control; the API refuses every other run with reason `active` |
| Limit | The 257th pin returns `pin_limit`; link to the `pinned=true` list filter |
| Retention | The preview states when pinned runs make a budget unreachable (they still count toward the completed-count and storage figures) |
| Manual delete | `protected_dependency` with reason `pinned`; the dialog offers Unpin first |
| Restored history | The pin state at backup time is shown read-only; no toggle (the routes return 403) |

## Interface states

| State | Display |
| --- | --- |
| Unpinned | Outline pin button "Pin" |
| Pending | Button disabled with a spinner; the badge is not shown until the receipt returns (no optimistic pin, because retention depends on it) |
| Pinned | Filled pin, label "Pinned", badge on the run header and list row |
| Unpin pending | Spinner; the badge stays until the receipt returns |
| Limit | Inline error under the button: "256 runs are pinned in this workspace. Unpin one to pin this run." with a link to the pinned filter |
| Conflict / unavailable | Inline error with Retry; the state shown is re-read from the server |
| Not pinnable | Button hidden for every nonterminal state, including finalizing; disabled with reason (`cleanup_in_progress`) once removal is admitted |

## Evidence

Backend evidence (shipped): `app/test/storage/run-pins-migration.test.ts`
(populated schema 030 upgrade), `app/test/storage/run-pins.test.ts` (limit,
idempotency, replay, epoch, SQL guards, retirement),
`app/test/retention/pins.test.ts` (never a candidate, delete refusal, Apply
recheck, pin versus admission race), `app/test/recovery/historical-pins.test.ts`
(read-only history) and `app/test/http/runs/pins.test.ts` (routes and reasons).
Interface evidence: a viewer test that each state above renders from the
receipt and that history renders `pinned` without a write path.
