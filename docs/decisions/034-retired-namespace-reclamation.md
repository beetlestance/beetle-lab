# Decision 034: Retired namespaces reclaim through ordinary output deletion

Status: accepted. Recorded on 20 November 2026. Amends [decision 020](020-workspace-retirement.md).

## Decision

The backend itself begins the ordinary output deletion intent for each eligible
terminal Run of a retired workspace. A retired organisation is covered because all
of its workspaces are retired. Nothing new deletes rows or files: each intent then
takes the existing path. Files are removed and proven absent, the agent retires the
Run, the backend records the ACK, and settlement refunds. Freed bytes appear only at
settlement.

- The output deletion runtime gains a fourth lane, used only when settlement is
  configured. It starts at most 32 intents per turn, and an empty pass waits 30 s.
- The walk is a keyset over `workspaces_page`, then `runs_page` inside a retired
  workspace. Each candidate is checked with indexed probes. A cursor is only a
  position hint: Run headers are read only while their workspace is retired.
- Intent and request IDs are derived from the Run ID. A lost reply or a replayed pass
  begins the same intent, and `run_id` stays unique.
- A Run is offered only if settlement can later purge it. It must be terminal, with
  no intent, pin or note, exactly one attempt, and no export job. It must also have
  positive custody and a funded cleanup control, as retention requires. Other Runs
  wait and are skipped.
- No receipt, charge or new reservation is written. The intent uses the cleanup
  control the original already paid for.
- Published inputs are not reclaimed. Saved revisions pin them for good, and
  unpinned input deletion stays an explicit public flow.

**Pins keep protecting after retirement.** A pinned Run in a retired workspace is
never offered. Retirement already makes unpinning impossible, so its bytes stay
reserved for as long as the installation exists.

## Why

Reusing the deletion pipeline keeps the safety records decision 020 protects.
Receipts, the namespace marker, replay floors and the per-Run tombstone written by
settlement all survive. Bytes are claimed only once the agent has proven cleanup.

Pins: a pin is an explicit instruction to keep one Run. If retirement silently
overrode it, retiring a workspace would destroy data someone chose to keep, and that
cannot be undone. Keeping pins also leaves migration 033's guards and the settlement
purge authority unchanged. The cost is bounded: at most 256 pins per workspace.

## Alternatives

- Cascade delete on retirement: rejected for the reasons in decision 020.
- Let retirement release pins: rejected. It overrides a deliberate keep, and it
  needs new trigger exceptions for a state where no user can act.
- Widen retention discovery to retired scopes: rejected. Retention is a policy over
  age and the storage cap. Retirement is a different trigger and must not depend
  on retention settings.

## Consequences

No migration. Noted, multi-attempt and export-linked Runs in retired workspaces are
not reclaimed, because settlement cannot purge them today. Legacy Runs without a
cleanup control ledger row are not reclaimed either. These bytes stay charged until
settlement learns to purge them.

A Run that passes every check but then makes Begin fail with an unexpected error
fails the whole output runtime, as every other lane does. The cursor is held in
memory, so after a restart the sweep reaches that Run again. No such path is known.
The checks match the guards in migrations 013, 021, 024 and 033. A failure is
reported rather than skipped silently, so the cause can be fixed. An idle reclaim
turn hands its slot to file removal, so the other lanes lose no share while nothing
is being reclaimed.

## Review triggers

Revisit if stranded pinned, noted or legacy Runs in retired workspaces become a
material share of installation storage, or if settlement gains a purge path for
notes, exports or retries, or if a reclaim failure is ever seen stopping the
output runtime.
