# Audit correction evidence

Recorded 17 November 2026. This is scoped local source evidence, not a release
certificate. Candidate CI and the scoped native/resource qualifications below passed.
Scoped isolated-browser checks pass; approved release protections are applied. Private installation data, credentials and raw logs are not published here.

## Source identities

| Boundary | Implementation commit |
| --- | --- |
| Installed memory increase | `fe84441ca958038f7ea8dc9332a87ed878200d7d` |
| GC fields and readable target reports | `b49ad85e064926e25cf367b6e41b5adeed98aec5` |
| Storage progress watchdog | `4b130b73e97e3a3fef5f032dc3df544b07098f0c` |
| Startup diagnostics | `f49b35678a4a1e1215be985c4e0e7e1bebb11eb3` |
| Environment approval guard | `6c0ee23cc04a37fd04ba69ab28f0881336a33aa0` |
| Settings row validation | `947b62e72b8bc44df431fd5384a10292313b0d99` |
| Failed-operation diagnostic context | `5b94b31bf3fbcd47d759ff37c09b2f19d8f967a1` |
| Packaged agent startup and preserved runtime causes | `8a38d15ad71e9563cecedc24d86c71a990dfc900` |
| Aggregate output-capacity coordination | `40c4a5c181a890434c1b540ad09acde7dea7b8db` |

Later commits retain earlier changes. Check results apply to their relevant source,
fixtures and configuration; this table does not imply a full suite ran at each SHA.
The local Node runtime was 24.22.3; Vitest used one file worker. Every boundary
received independent review. Reviewers reused passing checks instead of rerunning them.

## Accepted local behavior

- **Memory:** the supported offline operation changed the existing installation
  from 512 MiB to 1 GiB. Backend/agent configuration agreed, settings advanced once,
  and existing history counts and a saved result digest remained unchanged.
  The approved output increase now raises that separate pool to 512 MiB inside
  the unchanged 2 GiB storage allocation. The cold journal bytes and retained-hold
  counters were identical before/after; prior result digests remained unchanged.
  A local ARM64 workload passed with actual engine memory/swap each 1 GiB, no
  OOM kill and exit zero. A sealed cold backup was retained before maintenance.
  See [operation contract](../../site/src/content/docs/guides/change-capacity.md).
- **Reports:** source tests cover explicit GC count/total/average/max readings,
  active handles, older artifacts, missing samples, chronology, target restarts,
  visible counter resets, overflow and owned attempt-to-artifact/text publication.
  Text reports now include target memory, CPU and GC sections. Sampled analysis
  remains advisory and does not change test outcomes or prove absence of leaks.
  The 78-test feature lane passed; later fixture/helper corrections passed their
  affected UI/summary/publication checks. The current local packaged workload
  published 121 available target samples including GC fields; target JSON, text
  report and CSV downloads matched their sizes and SHA-256 digests. The isolated
  browser checks below confirm actual presentation and download interactions.
- **Storage:** real SQLite workers drain 32 durable operations delayed 170 ms each,
  exceeding five seconds overall without false timeout. Queue overflow still
  refuses, close drains, and reopening preserves committed work. A five-second
  interval without a completion remains fatal. New enqueues cannot renew it.
  Stalls, crashes, unknown outcomes, large-operation limits, broken log sinks and
  failed-operation attribution are covered. No mutation is automatically retried.
- **Diagnostics:** 33 startup/configuration tests passed, including real failed
  executable entrypoints. Logs contain bounded allow-listed causal codes, never
  raw error messages, stacks, submitted paths or credentials. Descriptor accessors
  and cycles cannot create unbounded diagnostic traversal.
- **Settings rows:** a pre-fix real worker returned a malformed scoped settings
  UUID. It now rejects invalid identity, scope, version, JSON and closed value
  shapes. Oversized UTF-8 values are bounded in SQL before projection. Identity
  reads and original receipt replay remain independent of defaults and runtime.
  The settings/capacity lane passed 30 tests, including offline-change compatibility;
  nine focused row cases passed after review additions. Other row owners are not
  certified by this targeted correction.
- **Release authority:** 40 authority/GitHub/trust tests passed. The read-only
  live guard originally refused the missing release environment. Both publishing
  jobs reference the approval environment. After explicit user approval, repository
  defaults are read-only, Actions cannot approve PRs, and `beetle-release` requires
  `akshay253101` review with exactly the `rewrite/integration` branch rule. Fresh
  API reads match the requested settings and the live guard passes. Main/develop
  heads remain unchanged; no publication was performed.
  See [release approval](../engineering/release.md).

After the final storage-context change, the composed local lane passed **58 tests**
across storage progress/lifecycle, journal lifecycle/credits and settings-row cases.
Node type checking, lint, architecture and documentation gates passed. Earlier
feature corrections preserved failed check logs; only affected checks were repeated.

The later bundle lane built the API, agent, engine and web, checked engine-runtime
TypeScript, and passed both packaged API and agent entrypoint smoke checks.
The agent fixture initially lacked required durable authority; it now initializes
real journal/control owners before startup. Runtime errors retain their original
cause, and fixed reason codes remain safe to log. Thirty startup/configuration/runtime
tests passed; the final diagnostic helper correction passed its five focused tests
and static gates. Normal CI now includes the agent smoke. Its Docker daemon is a
fixture: these checks do not establish native container or target-workload acceptance.

## Release decisions and limits

Retain the unexplained original conformance failure; a later pass is not its cause.
Publish only after explicit approval and the configured GitHub review gate.
The scoped non-UI corrections have accepted evidence; this is not release approval.

Running services use matching locally built candidate images, including the
report, storage, diagnostic and settings changes. No merge
to `develop` or `main`, ruleset alteration, registry promotion or deletion occurred
during this correction batch.

Candidate [CI 43996681055](https://github.com/beetlestance/beetle-lab/actions/runs/43996681055)
passed all source, six test-shard and both native image jobs at `40c4a5c1`; eight
archive identities were verified. No images were published. The subsequent
[read-only observation](https://github.com/beetlestance/beetle-lab/actions/runs/44002956313)
contains a failed conformance job and a successful long-stream job. The failed
case was not reproduced by the separately instrumented six-case conformance run;
its original cause remains unknown. Fixed, redacted failure locations are retained
for future native conformance failures.

## Hosted finite resource evidence

All cases below use runtime source `40c4a5c1` and matching six-image identities.
They reuse the qualified archives; no runtime rebuild or publication occurred.
Execution, source/harness identity and independent cleanup were checked from the
closed artifacts. No tests were rerun merely to review these measurements.

| Case | Harness / run | Observed result |
| --- | --- | --- |
| Six engine/request/admission cases | `4e3adfc3`, [44004323095](https://github.com/beetlestance/beetle-lab/actions/runs/44004323095) | All six pass; original failure above remains unexplained. |
| Long stream | `40c4a5c1`, [44002956313](https://github.com/beetlestance/beetle-lab/actions/runs/44002956313) | 1,836 seconds active; three fresh-reader spans over 1,823 seconds; live-read p95 111.02 ms including unavailable responses, 111.51 ms for successes. |
| Four retained runs | `59a00083`, [44005995328](https://github.com/beetlestance/beetle-lab/actions/runs/44005995328) | Live p95 107.5–196.2 ms; backend/agent final RSS below warm-up by 12.19/5.64 MiB. |

The long component retained 51 unavailable responses among 2,696 live reads.
Its whole workflow remains failed because of the separate original conformance job.
The four-run case uses fixed 32-second post-idle windows and compares final
8-second median summed process RSS after warm-up and after the fourth run.
Every pooled and live-specific p95 stays below the unchanged 250 ms target;
final RSS growth stays below the unchanged zero-byte target for both processes.
All four results retain their original 8 MiB output plus 64 KiB cleanup allocations,
and every run's eight final artifacts were verified. Settings, container identities,
start times and caps stayed unchanged; no forced GC, restart, history purge or pool
increase was used. This closes these finite blockers, not a universal leak-free or
uninterrupted-availability guarantee. Private evidence and local backup are retained.

## Isolated browser acceptance

A cached Playwright image ran Chromium146 in a fresh unprivileged container and
context against the existing real ARM64 run, without a personal browser profile,
Docker socket, new performance run or app configuration change. A container-local
loopback relay preserved the normal frontend Host/Origin/session handling.
The bounded check passed in12.87 seconds with 1 GiB/1CPU/256 PIDs and owned cleanup.

Seven metric selections verify847 displayed sample values and28 summary values,
including RSS,CPU,explicit GC fields and unavailable values. Rendered report text
matches the published digest. Four actual UI downloads verify bytes/SHA-256:
the text link and inventory text/targetJSON/CSV links. Explicit report reload and
browser reconnect preserve values, with no page JavaScript errors. GC/text
screenshots were inspected; runtime image IDs match the accepted40c4a5c1 images.
The initial missing-headless-shell attempt is retained; selecting the existing
full Chromium binary resolved test setup without changing the application.
This covers functional report presentation and manual-read interactions. It does
not certify responsive layout; long report lines can cause horizontal overflow,
which remains in the separately deferred UI work. Private screenshots stay private.

## Storage lifecycle and clock-skew follow-up

The live-metric clock correction is `097e644d`: the agent supplies a remaining
freshness budget and the backend consumes it with its own monotonic clock. Agent
wall-clock offsets no longer invalidate fresh frames. Repeated frames cannot renew
their expiry. The focused lanes passed 72 composed tests and 25 final review tests.

The next source packet adds fatal-storage notifications, fixed private health
responses, real process failure exits and image/Compose probes. Worker-failure
health tests, faulty observers, IPv4/IPv6 listener probes and real child-process
shutdown/deadline tests pass. Independent review accepted the source boundary;
types, lint and architecture pass. These new packets are not deployed or included
in the earlier native image qualification. Docker socket authority, broader row
validation and repository formatting remain open review findings.
