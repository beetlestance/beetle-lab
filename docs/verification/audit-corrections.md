# Audit correction evidence

Recorded 17 November 2026. This is scoped local source evidence, not a release
certificate. Hosted CI and native qualification of the assembled candidate remain
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

Later commits retain earlier changes. Check results apply to their relevant source,
fixtures and configuration; this table does not imply a full suite ran at each SHA.
The local Node runtime was 24.22.3; Vitest used one file worker. Every boundary
received independent review. Reviewers reused passing checks instead of rerunning them.

## Accepted local behavior

- **Memory:** the supported offline operation changed the existing installation
  from 512 MiB to 1 GiB. Backend/agent configuration agreed, settings advanced once,
  and existing history counts and a saved result digest remained unchanged.
  The new engine container has not executed: retained output reservations fill
  the separate output pool. This is not proof of native 1 GiB enforcement.
  See [operation contract](../installed-memory.md).
- **Reports:** source tests cover explicit GC count/total/average/max readings,
  active handles, older artifacts, missing samples, chronology, target restarts,
  visible counter resets, overflow and owned attempt-to-artifact/text publication.
  Text reports now include target memory, CPU and GC sections. Sampled analysis
  remains advisory and does not change test outcomes or prove absence of leaks.
  The 78-test feature lane passed; later fixture/helper corrections passed their
  affected UI/summary/publication checks. Current packaged/browser acceptance is open.
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

## Remaining acceptance

1. Approve and apply the proposed GitHub token/reviewer settings, then verify the
   configured policy. Do not bypass its deployment gate.
2. Resolve the separate retained-output capacity decision while preserving history.
3. Run exact-source hosted CI and native candidate checks after source push approval.
4. Execute the target workload with the 1 GiB container limit and verify current
   target JSON, text downloads and browser details through the packaged application.
5. Close required hosted resource evidence and publish only after explicit approval.

Running services still use the locally built memory-change images. Subsequent
report, storage, diagnostic and settings changes have not been deployed. No merge
to `develop` or `main`, ruleset alteration, registry promotion or deletion occurred
during this correction batch.
