# Durable stop evidence

Date: 2026-11-09. Integrated source: `d0b2f20`.
Environment: Node26.7.0/macOS arm64, real SQLite and temporary files.

## Implemented path

Supervision stores the first stop time/reason independently from a monotonic
immediate-stop flag. User cancellation, timeout, output_limit, artifact_incomplete
and clock_integrity remain distinct internally. Migration007 preserves existing
rows; historical cancellation without a known reason remains unknown and fenced.
No queue, reservation, launch claim, artifact or result is released by the migration.

The private installation stop port supplies output-control or incomplete-output
failure reasons. Runner HTTP cancellation remains user cancellation only. Actors
recover the first reason and escalation before deciding how to terminate. User
and timeout grace retain their original ceiling; urgent stops select kill when
the owned lane can signal. Clock emergency diagnostics do not hide an existing
primary output cause in runtime exit evidence. OOM evidence retains precedence.

Installation, attempt and actor cancellation caches retain one bounded urgency
upgrade. The actor coalesces an urgent follow-up after a held original metadata
response. Pending create/start originals must settle before signalling; stop
acknowledgement means durable intent, not termination completion. Control intake
and checkpoint failure now request artifact_incomplete rather than user cancellation.

## Independent review and corrections

Review reproduced user cancellation followed by output_limit failing to escalate,
including during held start. It also reproduced clock rollback hiding the durable
output reason from runtime.exited. The corrected durable flag separates urgency
from attribution, cached lanes retain the upgrade, and exit evidence uses the
persisted primary reason while clock safety still governs signalling.

Four independent real SQLite/Supervisor probes passed final corrections: sequential
escalation, held-start fencing, rollback attribution and128 urgent callers during
a held original cancellation response. The last probe observed one cached urgent
promise and exactly one output-limit follow-up write. Retirement refused pending
originals and succeeded after their settlement. Review accepted26 source hashes.

Production regressions cover first-reason races, restart, v6 unknown-cause migration,
invalid commands, transactional failure, timeout recovery, immediate system stops,
held metadata and start work, clock safety and manager/controller composition.
Older migration fixtures now model pre007 tables accurately; their preservation,
rollback and future-version checks remain in place. Controller failure tests assert
typed system failure plus kill rather than the previous graceful user-stop behavior.

## Executed checks and limits

`npm run verify:v2` exited0 on the exact source: **2358 tests/202 files**, three
TypeScript projects, lint, generation37/23/6, architecture673, docs106 and frontend
build. The existing611.56kB/178.59kB gzip main-chunk warning remains.

Backend mutation results are controlled fixtures. Real output/free-space scanning,
freshness watchdogs, actual Docker startup and full-pool stop latency/overshoot
are not qualified. Serial actor ownership can delay urgent signalling behind
original backend or journal work. This supplies no portable disk quota or guarantee
against filesystem exhaustion. Irreversible retirement of uncertain remote dispatch,
artifact/application finalization, architecture matrix, scans, backup and soak remain.
No image build/pull, publication, deployment or hosted CI was performed by this slice.
