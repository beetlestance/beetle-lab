# Read-only cold repeated-fixture accounting

Reconstruct retained storage charges from stopped, task-owned qualification data.
Verify archive, configuration, source, image, installation and expected run IDs
before opening a database. The original baseline was `450644d6` (ARM fixture 4).

- Read SQLite with read-only/query-only settings; compare file hashes afterward.
- Recompute backend debt from allocations, finalization credits and paid cleanup
  or retention owners. Verify that excluded owner categories are actually empty.
- Reconcile agent holds, counters, released reservations and owned files.
- Bound directory entry count, depth and file size; refuse symlink traversal.
- Distinguish file size, logical debt and host blocks actually freed.
- Never start services, install, migrate, rewrite user data or infer refunds from
  a zero-byte file. Evidence creation and independent review belong to the root.

Cold check 2 passed in 1491 ms using 32 artifact copies and no new workload.
Source lookup requires the reviewed qualification entries; sibling/private/reverse
lookup refusals remain enforced. See the [evidence](https://github.com/beetlestance/beetle-lab/blob/4fabd9fa0db7c9de3fe6be8a749eeace83cfdddc/docs/verification/cold-repeated-accounting.md).
The journal charge sum alone does not reconstruct every metadata body.
