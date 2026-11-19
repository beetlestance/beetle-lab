# Decision 030: Reconciling task folders after a renumbered root

Status: accepted. Recorded on 19 November 2026. Completes the offline
reconciliation that [decision 029](029-durable-staging-identity.md) left open.

## Decision

A prepared task whose recorded folder facts went stale (the installed root was
renumbered between starts) can be reconciled. Reconciliation records the
folders' newly observed facts beside the task anchor. It never edits the anchor,
its `taskNamespaceIdentity` or any retirement, plan or receipt record.

Reconciliation runs only through the retirement pipeline's reconcile entry, from
an explicit operator command, never from a cleanup tick. In order it:

1. replays the attempt's stored retirement request through producer and runtime
   retirement, so the original runtime is proven absent by ID and name on the
   bound daemon (a same-name container refuses);
2. refuses if the attempt already settled, has no prepared task, or has any
   cleanup plan, progress or receipt;
3. finds the folder by its recorded name under this start's verified root,
   without following links, on the live root's device, and reads the whole tree
   with the same checks as cleanup inventory;
4. requires each of the four folders to keep the recorded owner, group and mode;
   device and inode numbers are observations for the current verified start, so
   any values are accepted (when they equal the facts cleanup already checks
   against, it reports `current` and records nothing);
5. records `{taskNamespaceIdentity, retirementRequestDigest, directories}` in
   Journal schema 27's `reconciliation_json` column.

The Journal checks the durable side again in the same transaction, and a SQL
trigger refuses any write that clears the column, names another retirement, or
happens once a cleanup plan, progress or receipt exists. A reconciliation may be
replaced while no plan exists, so a second renumbering before cleanup is
recoverable. Because the record is never cleared, folders that move A→B→A
replace a recorded B with facts equal to the anchor's A; the anchor itself never
changes. Inventory, removal and the plan trigger then compare role folders
with the reconciled facts instead of the anchor's.

## Why

After decision 029, an ordinary Docker Desktop restart no longer blocks the
installation, but folders prepared before it stay unresolved: their recorded
inodes no longer match, so cleanup refuses them and the retirement can never
finish. Matching on the deterministic name and the namespace marker alone would
let any directory at that path inherit deletion authority. Proving the writer is
gone and that ownership still matches is what makes the new facts trustworthy.

## Alternatives

- Reconcile automatically inside a cleanup tick: rejected. A tick is driven by
  the control plane and must not turn stale facts into authority on its own.
- Re-seal the anchor with new facts: rejected. The identity is bound into the
  retirement intent and every plan; changing it would orphan them.
- A new attempt-scoped table: rejected. It would need its own settlement purge,
  isolation and charge. The column fits inside the frozen 8 KiB task row budget,
  so the version 1 cleanup-control reserve and settlement stay unchanged.
- Adopt a plan stored before renumbering: rejected. Its entries name the old
  files, so it is refused; such an attempt stays unresolved for the operator.

## Consequences

Facts observed before reconciliation never authorise removal: a stored plan
blocks reconciliation, and removal checks every entry against the live files. A
folder whose mode or owner changed, or that holds links or special files, stays
refused and in place.

## Review triggers

Revisit if task folders gain an ownership file, if staging moves to a profile
with stable inodes, or if settlement starts purging task rows separately.
