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

At that stage, a bounded V2 correction and fresh native qualification were next.
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
capture regression and existing custody cases passed before the subsequent native attempt below.

## Sustained V2 stream and separate final reads

Sourceb48936d8/harness570b6166, native ARM64/Node24.22.3. The next original trial
lasted1912.693s and passed its stream gates, then failed final-drain collection at
the fixture's256-read fragment bound. Both cleanups passed. Its status remains
failed; this paragraph does not rewrite that outcome as an uninterrupted pass.

| Sustained observation | Accepted facts |
| --- | --- |
| Active original |1838366.951ms (30m38s), owned running identity/generation and shipped1CPU/512MiB/PID128 controls. |
| Three readers |826/830/822 fresh frames over1824984.579/1828387.151/1827086.867ms; all exceed29min. |
| Refused reads/gaps |193 of2671 live reads refused; longest new-frame gaps8.260/6.275/8.111s. No uninterrupted-availability claim. |
| Latency |934/934 Run reads succeeded, p95=7.34ms;2478 successful live reads p95=183.86ms (all live p95=181.19ms). |
| Target |1 readiness,1830 work,0 unexpected requests before teardown. |

A separately supervised18.714s final-read replay reopened only the original owned
backend/agent/frontend, with no setup, target or new Run. Pre/post cold snapshots
showed the same single finished/passed Run and attempt, released execution, zero
event/delivery debt. No managed execution container appeared. All eight original
artifact sizes/SHA256 values verified, including7913483byte metric windows with
SHA25655623bc253ad0997647370ba7d41efcea54e0e23b0be090c2d30a443fb211e50.
Normal and independent replay cleanup passed; terminal live reads remained unavailable.

The collector now allows an explicit4096-read budget for these <=16MiB final
artifacts, retaining byte/digest/body-timeout bounds and awaiting cancellation. Its
default256 remains unchanged. A separate private4MiB no-follow/single-link report
reader handles the retained timing report; delivery metadata remains capped256KiB.
Three focused fragment/report tests, types, lint, architecture/docs and independent
review accompany the correction. This combines sustained-stream and separately
recovered final-byte evidence. Post-idle retained-growth and native AMD64 long-run
qualification remain open; it does not establish full Q03/Q04 acceptance.
