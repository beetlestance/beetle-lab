# Audit correction evidence

Recorded 17 November 2026. This is scoped local source evidence, not a release
certificate. Candidate CI passed; broader native/resource qualification remains
open. Private installation data, credentials and raw logs are not published here.

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
  See [operation contract](../installed-memory.md).
- **Reports:** source tests cover explicit GC count/total/average/max readings,
  active handles, older artifacts, missing samples, chronology, target restarts,
  visible counter resets, overflow and owned attempt-to-artifact/text publication.
  Text reports now include target memory, CPU and GC sections. Sampled analysis
  remains advisory and does not change test outcomes or prove absence of leaks.
  The 78-test feature lane passed; later fixture/helper corrections passed their
  affected UI/summary/publication checks. The current local packaged workload
  published 121 available target samples including GC fields; target JSON, text
  report and CSV downloads matched their sizes and SHA-256 digests. Browser
  acceptance remains open.
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
  live guard refused the currently missing release environment. Both publishing
  jobs reference the approval environment. Administrator settings are prepared,
  not applied; source commits alone cannot configure GitHub policy.
  See [release approval](../release-approval.md).

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

## Remaining acceptance

1. Approve and apply the proposed GitHub token/reviewer settings, then verify the
   configured policy. Do not bypass its deployment gate.
2. Resolve the later hosted AMD64 conformance failure; retain its original evidence.
3. Complete the running long-stream check and required hosted resource evidence.
4. Verify browser presentation/download interactions for the packaged report.
5. Publish only after explicit approval.

Running services use matching locally built candidate images, including the
report, storage, diagnostic and settings changes. No merge
to `develop` or `main`, ruleset alteration, registry promotion or deletion occurred
during this correction batch.

Candidate [CI 43996681055](https://github.com/beetlestance/beetle-lab/actions/runs/43996681055)
passed all source, six test-shard and both native image jobs at `40c4a5c1`; eight
archive identities were verified. No images were published. The subsequent
[read-only observation](https://github.com/beetlestance/beetle-lab/actions/runs/44002956313)
has a failed conformance job under diagnosis and an unfinished long-stream job.
