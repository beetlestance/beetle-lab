# Read-only cold repeated-fixture accounting
Base450644d6, root implementation. Reuse stopped ARM4 synthetic fixture data;
no new workloads/service start/installer/migration, no user installation reads.
Owner/outcome/source image binding and exact4expectedRun IDs precede database reads.
Open existing SQLite readOnly/queryOnly and verify file hashes before/after.
Recompute current backend debt from allocations minus finalization credits plus
paid cleanup/retention owners; require excluded owner categories actually empty.
Reconcile agent retained holds/counters/reservation release and actual per-owner
staging/output files with explicit entry/depth/size bounds and no symlink following.
Actual file size, logical debt and host freed blocks are different observations.
No recursive cleanup, refund or zero-byte inference. Root owns evidence/review.

Coldcheck2 passes1491ms; sourcefixture32artifactcopies, no newworkload. Source
lookup uses reviewedexact qualification entries; sibling/private/reverse tests
stay enforced. Evidence: docs/verification/cold-repeated-accounting.md. Stored
journal charge sum is not independent reconstruction of every metadata body.
