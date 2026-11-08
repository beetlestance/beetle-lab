# k6 outcome mapping evidence

Date: 2026-11-08. Integrated mapper: `afbc05f` plus correction `1661e34`.
Combined verification and native smoke source: `99751a1`.
Environment: Node26.7.0, stock k6 v2.2.0, macOS arm64.

The pure mapper has 130 focused tests. Independent review reproduced two
counter-bound contradictions, then verified their correction with 300 lower-bound
oracles. All ten orchestration-failure overrides preserve native facts and prevent
pass. Pending overall quiescence prevents sealing; missing mandatory receipt fields
are rejected. No mapped result authenticates an engine or verifies artifact custody.
See [the decision contract](../decisions/011-k6-outcome-evidence.md).

## Executed composition

The [manual native check](native-k6.md) ran two sequential owned-loopback cases,
each with one VU, one iteration, one readiness request and one workload request.
It composed the production compiler/builder, native process test seam, stream
decoder, accumulator, summary collector, mapper, seal codec and control journal.

| Workload response | Native exit | Mapped outcome | Required definitions | Replayed journal |
| --- | --- | --- | --- | --- |
| HTTP200 | 0 | passed | 1 passed, 0 failed, 0 unknown | 950 bytes |
| HTTP500 | 99 | failed | 0 passed, 1 failed, 0 unknown | 951 bytes |

Both cases asserted completed execution and complete decision/window evidence.
Measured HTTP count was one, excluding readiness. Each stream contained 48 records;
byte counts were 9,037 and 9,023 respectively. Native durations were 107.730 ms and
104.987 ms; counter rates matched the declared whole-engine denominator.
Original execution/collection closes completed before mapping. The control writer
synced and closed each sealed result; read-only replay and content-seal verification
recovered the exact same result. No downloadable artifacts were declared.

At that clean source, `npm run verify:v2` exited 0: 1,780 tests in 149 files,
all three TypeScript projects, lint, generation37/23/6, architecture521 and docs77.
The frontend build retained its 611.56 kB / 178.59 kB gzip chunk warning.

## Qualification limits

This uses the private Darwin compatibility seam; the public product still requires
Linux. The staged wrapper entrypoint, independent result-file publication, agent
transport/recovery, application finalization and artifact custody remain separate
implementation or qualification work. Journal filesystem checks are not power-loss
proof. No Node24 runtime, Docker, native amd64 or release qualification is implied.
