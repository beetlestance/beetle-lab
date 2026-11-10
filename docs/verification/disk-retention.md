# Retained execution disk accounting

Status: independently reviewed and locally verified journal/admission integration.
Code source `b3c3cc2f28307d0651f1569c1a196820f31e8695`; integration
`e9c2434c0546b3c1f5d9d394075f3f22d036af59` has an identical tree.
Contract: [disk retention](../design/lld/disk-retention.md).
Full repository verification remains pending for this source.

## Implemented behavior

Actual admission atomically reserves one immutable disk hold, a bounded hold slot,
and a512-byte journal metadata charge. Execution release and unstarted abort move
both original output and staging promises into retained usage exactly once.
CPU/RAM/PIDs, execution concurrency and isolation remain active-only resources.
Admission includes retained usage in logical pool fit and fairness, while keeping
native available-space checks separate so existing files are not counted twice.

Journal migration011 conservatively retains all trustworthy old reservation debt.
Unrepresentable count, identity, amounts or quota fail the entire upgrade without
changing old data/schema. Lower current pool settings preserve representable debt.
SQL guards bind hold identity, immutable amounts, metadata charge and phase to the
original reservation; normal admission reads compact counters.

## Local checks and review

Darwin arm64, Node26.7.0. On the composed code source:

- `vitest run agent/test/admission agent/test/disk-retention agent/test/journal
  --maxWorkers=1`: exit0,391 tests/38 files,95.74s.
- The corrected reservation native-read and SQL write-byte cap tests separately
  passed42 tests/1 file,10.98s. The four final historical fixture corrections
  separately passed55 tests/4 files; their Node types/scoped ESLint passed.
- Independent SQL/migration and policy reviews inspected unchanged production
  source `7f46e739994367578c3a9b9977c3379eb7be213c` without blocking findings.
  Independent test review required restoration of a separate native-read byte cap
  oracle; that correction and the remaining fixture changes were reviewed clean.
- An earlier composed run failed9 tests in four historical/corruption fixtures.
  Their construction now respects the new schema and earlier write guards.
  Existing migration rollback, native immutability and writable corruption read
  oracles remain; no current production guard was disabled to obtain a pass.

Real compiled Journal-worker tests intercept a successful response only after the
native transaction commits. They prove the issuing caller remains pending, abort
that worker owner, reopen the same path/authority UUID and inspect exact native
hold/counter/reservation/metadata state. Repeated release and abort replay cannot
transfer or charge twice, and retained pressure defers a subsequent original.
Runtime and collection evidence in these fixtures is synthetic, not a real engine
or physical-file occupancy measurement. This proves worker RPC response-loss
recovery; it does not establish power-loss or abrupt-process crash durability.

## Remaining boundary

There is no file deletion, hold refund, source manifest, source receipt or backend
artifact adoption in this step. Event ACK/pruning does not refund disk holds.
Verified source persistence and matching-receipt finished-release gating remain
required before transfer/finalization. Unknown or failed collection keeps its disk
promises; this logical accounting is not a physical filesystem quota.

Full repository checks, complete engine/backend execution, fresh Docker install,
native architecture qualification, scans, backup/restore and soak remain required.
