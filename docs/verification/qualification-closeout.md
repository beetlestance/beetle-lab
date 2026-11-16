# R0–R4 qualification closeout

The finite failure/resource and parity goal is qualified at the recorded source,
image and platform boundaries. Candidatecf44e96a passed source CI43872965435;
current runtime inputs are unchanged through evidence-only closeout commits.
[All69 acceptance IDs](final-acceptance.md) retain their specific proof and limits.
Independent review found no unproved required behavior after the current long-run
latency result and bounded repeated-memory evidence were included.

| Requirement | Authoritative composed evidence |
| --- | --- |
| Q01 hard controls | [Native AMD64/ARM64 CPU/OOM/PID/descendant controls](resource-controls.md), [known/unknown cause projection](system-stop-classification.md) |
| Q02 lifecycle | [Both-native active crash/cancel/recovery](active-recovery.md), [durable phase map](lifecycle-phase-evidence.md), charged uncertainty and original execution identity |
| Q03 bounded load | [Flood/held-reader cancellation](flood-slow-cancellation.md), [cardinality/four runs](bounded-repeated-load.md), [current memory](repeated-memory-analysis.md), [long stream/final drain](long-stream.md), [shared/isolated admission](native-parallel-admission.md) |
| Q04 overhead | [Both-native short control](short-control-overhead.md), [both-native telemetry](telemetry-comparison.md), [current AMD long p95193.16ms](long-stream.md), service ceilings and separately measured RSS |
| Q05 storage/recovery | [Bounded ENOSPC](bounded-disk.md), [native cold history/exact restore resume](packaged-cold-recovery.md), [current schema29 ARM/old-reader refusal](current-candidate-qualification.md), [recorded older compatible pair](source-cold-history.md) |
| Q06 feature/browser parity | [36 F/N IDs, nine acceptance groups and24 adversarial IDs](final-acceptance.md), [actual functional browser](goal-qualification.md), [keyboard/themes/viewports/cross-scope](browser-interactions.md), [reference/downloads](browser-reference.md) |
| Q07 evidence reconciliation | Independent source/native/browser composition review plus current latency/memory review; [candidate boundary](current-candidate-qualification.md), preserved historical failures and explicit limits |

The original250ms latency,5% telemetry and memory ceilings were not raised. No
retained RSS growth was observed after the fixed four-run sequence with32s
post-idle windows; this is not universal leak freedom. Current AMD live reads meet
the latency target in the recorded fixture;82 unavailable reads remain explicit.
Earlier failed trials and the293.49ms result retain their original outcomes.

Qualification uses deterministic failure/race cases plus actual native boundaries,
not a claim that every permutation was faulted on both platforms. Restoration is
fresh read-only history; the tested722 reader refused the specific schema29 archive. There is no mutable/in-place restore or general rollback guarantee.
Original/live stderr, recursive folder deletion and automatic thermal readiness
remain unsupported. Deferred UI redesign, engines, hosted IAM and legacy migration
are outside this finite goal.

Published rewrite candidate72243a87 is unchanged. Candidatecf44e96a has qualified
immutable archives, scans/SBOM/license and native execution; it has not replaced
the public default. New publication/default changes require their own authority.
User services/data were preserved; faults used synthetic owned storage/containers,
never host-disk filling or daemon pruning. Merged task trees/branches are removed.
