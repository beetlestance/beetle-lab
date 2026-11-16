# Actual long-stream qualification

Date2026-11-16. Source images23bb8c82, native ARM64; archive size115389921bytes,
SHA2563bb63ef544bb9b97522d863ae8433786836c09cf152aa12905e38afa09439c4a.
Harness basef075ea00 plus frozen task-source hashes. Normal packaged provisioning
established a UID1000 parent; the public advanced installer created a fresh child.
Only execution wall ceilings/defaults became32min. CPU1/memory512MiB/PID128/output
64MiB and the shipped service caps, pool, headroom and control reserve stayed intact.

The declared workload was oneVU/1830iterations/1s waits/31minmax, with three
independent settled2s readers and external15s Docker stats. The outer36min
supervisor completed after1907.308s with failure. Normal and independent cleanup
both passed. No user services/data were selected.

| Observation | Recorded result |
| --- | --- |
| Reader polls | 893/892/893; each retained one current frame, no frame corpus. |
| Fresh frames | 760/776/779; all fresh updates stopped around1712s. |
| Refused reads | 133/116/114; roughly160s without new frames at the tail. |
| Service samples | 125 per frontend/backend/agent; raw counters retained. |
| Failed gate | Every reader must receive fresh frames spanning at least29min. |

This is failed qualification. Final result downloads and physical target counts
were skipped after the coverage assertion; neither is accepted from this trial.
Subsequent harness diagnostics retain the last bounded snapshot, terminal/active
facts and owned target counts before teardown without weakening any gate.

## Reproduced quota mechanism

A read-only source mount copied only the stopped synthetic SQLite main file into
a private forensic directory; queries ran on that copy. The source main hash was
preserved. The exact metric-window artifact was recovered and SHA256 verified:
7913866bytes, bf5859ceb0b70d70cc49d0e73caaaf524116732dcbd819e5663500f3422a8c20,
1836 retained windows. Original read-only SQLite querying on the read-only bind
refused lock-file creation; it did not mutate the source or establish a result.

Replaying those windows through the unchanged publisher/mailbox sink reproduced
an actual `quota` rejection at1705s:852 writes charged8318200 of8322816bytes.
The next full20-series frame was9292bytes. The publisher retains a generic sink
failure; the replay captured the sink's actual rejection code. This reproduces
a lifetime-byte cutoff near the native observation; the original producer's
private failure code was not retained, so it is not a captured historical cause.

A bounded V2 compression correction and fresh native qualification are next.
The8MiB lifetime wire budget,64KiB decoded frame,20-series subset and2s cadence
must remain. CPU/memory, final drain and fresh-frame span require a new actual run;
a faster in-memory replay cannot qualify the native thirty-minute requirement.

## First matching V2 attempt

Prepared source CI43793313636 atb48936d8 passed all12 gates and native image
archives. ARM staging verified immutable ZIP/archive/config/manifest/scanner and
isolated restoration proofs. The first actual V2 attempt then refused49.620s into
the fixture: its API-active observation preceded native container creation, and
the new strict original-capture assertion found no container. Both normal and
independent cleanup passed. This does not qualify sustained V2 metrics or diagnose
a producer failure. The qualifier now waits for an exact owned running original
before starting its measured span; missing/stopped originals cannot start it,
while identity/generation/image/CPU/memory/PID mismatches still reject. The33min
window,30min active minimum and29min fresh-span gates are unchanged. A delayed
capture regression and existing custody cases pass; new native execution is pending.
