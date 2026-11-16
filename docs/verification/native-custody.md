# Shared native custody evidence

Status: C3b prerequisite locally verified; no native cleanup operation/ACK/refund.
Contract: [shared custody](../design/lld/native-custody.md). Base2fe0326.

The actual collection and range entrypoints now share one strong output-native
registry. Their two-per-lane limits and previous aggregate maximumfour are preserved.
Future cleanup borrows free aggregate slots, at mosttwo; no guaranteed cleanup
headroom/fairness is implied. Scope binding excludes cleanup/read overlap before IO,
including an earlier reserved-but-unbound original. OutputLifetime remains the sole
original-close owner. Sticky failed close retains scope, lifetime and both credits.

Independent source review found no blocking issue. It did not duplicate the test
lane. Check-runner retained exact commands/exits/times/logs privately; source is the
introducing commit. Host Node26.7.0/darwin arm64, functional Vitest one-file worker.

| Check | Result |
| --- | --- |
| Initial collection/range/custody | 132/133tests; new trailing-slash scope case failed; validation corrected |
| Frozen custody/collection/range/transfer/producer | 237tests/26files passed,38.07s |
| Node types, lint, architecture | All exit0 |
| Agent build and docs | Both exit0 |

Tests use actual task-owned native files for collection/range; deterministic hooks
hold original closes after cancellation and reject actual close. They verify no
native open under a cleanup fence, credit retention until actual settlement, sticky
failed-close exclusion, lane/aggregate bounds, canonical scope spelling, sibling
prefixes and overlap in both directions. Existing capture reentrancy and native
custody tests remain green. The prior green files were rerun only after the relevant
shared admission implementation changed.

This is output-native admission/exclusion, not a global bound on all process IO.
Control/Stager/producer owners still require genuine C2 retirement. No replacement
registry may bypass retained state; trusted production composition must reuse the
singleton. Alias/mount/native identity validation, descriptor/memory bounds, complete
inventory, persisted plan before unlink, native Linux qualification and physical
receipt remain C3 responsibilities. No new container image or release was published.
