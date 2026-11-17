# Decision 027: Conservative output collection recovery

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

The agent persists an immutable collection intent before it runs the output
collector. After a controller or Journal restart, a pending intent with no source
is unresolved custody: it is never marked failed by elapsed time, a timeout, a
404 or source absence. Recovery may run one artifact-only recollection that reuses
the original intent, root, checkpoint, launch and runtime evidence under a fresh
bounded budget, and it never restages inputs or relaunches the engine. Only the
same uninterrupted controller, in the same Journal worker epoch, may record a
failed collection, and only after all of its originals quiesced and before any
success or commit attempt. A recovered failure stays pending, charged and visible.

## Why

Without an intent, a crash during collection is indistinguishable from collection
that never began, and a source commit that rolled back after a successful collection
looks the same as a failed collector. Labelling such a case failed would release the
reservation and disk hold while a valid source may still be recoverable, and would
let a quota or commit failure masquerade as a collector failure. Epoch equality
alone cannot prove the earlier collector did not succeed.

## Alternatives

- Treat a pending intent as failed after the execution deadline or a TTL: rejected.
  Elapsed time proves nothing about native custody or a rolled-back commit.
- Recollect freely on every restart: rejected. A committed source must win, and an
  unknown commit outcome must be reconciled first, or source identity diverges.
- Rerun the engine to regenerate outputs: rejected. It repeats target load and
  produces a different result for the same original.
- Allow any controller sharing the Journal epoch to fail the intent: rejected. The
  failure authority is process-owned knowledge, not a durable fact.

## Consequences

Some attempts stay charged and errored until an operator recovers them; capacity
accounting retains their disk holds. Source and intent states must agree; any
contradiction is unavailable rather than reinterpreted.

## Review triggers

Revisit if collection gains a durable per-artifact progress record that can prove
the earlier collector's outcome, or if retained errored attempts exhaust the
4096-hold ceiling in practice.
