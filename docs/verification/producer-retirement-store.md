# Durable producer retirement intent

Status: local C2a metadata boundary; C2b actual producer/read barrier remains pending.
Owner [contract](../design/lld/producer-retirement.md); parent
[retirement packets](../execution/output-retirement.md). No public endpoint is added.

## Result

Agent Journal017 adds one bounded immutable retirement intent per admitted released
performance original. Preflight and atomic begin share original, exact final closure,
final ACK, Journal authority, installed namespace/control and task-snapshot checks.
First backend Run/deletion binding is pinned; the Offer does not independently
establish a backend Run mapping. Exact retries survive lost reply/reopen/pruning.

Source closure requires a prepared task anchor matching the source output root and
claimed spec. Absence snapshots none/preparing/prepared task metadata without
inventing native absence. Rejected/unreserved originals return recovery_required.
Retirement metadata fits the existing196608-byte admission reserve; native disk
holds and all retained payload charges remain unchanged. SQL guards fence new
producer writes independently; typed application checks preserve usable observations.

Shared closed request <=3072 UTF-8 bytes; wrapped intent <=4096 bytes. Captured
worker commands enforce discriminated payloads, and replies bind scope even when
status is null. A failed Journal exposes its cached original worker termination
for the future local barrier, rather than treating promise rejection as settlement.

## Evidence

Task branch feature/producer-read-retirement, base e7ebdb4. Private source-bound
check plan, logs and report are archived at .agent-work/producer-retirement-c2a/ in
the canonical checkout. Development failures are retained with their corrections.
Final focused lane:28 tests in6 files passed (7.393s command); corrected native
fixture replay:3 tests passed (2.837s). Node types10.054s, contract drift0.272s,
API drift0.138s, lint6.538s, architecture12.758s, agent build0.754s, API build0.566s
and docs0.212s all exited0. Affected source/event/recovery/migration consumers:
158 tests in13 files passed (39.63s Vitest duration). Earlier broader storage lane
passed138 tests and failed1 crossed-command regression; the corrected focused lane
supersedes that failure. Test-only union/SQLite name narrowing and two lint issues
were corrected; unaffected green checks were reused.
No CI, published image or release claim follows from local evidence.

Focused coverage includes compiled Journal lost reply/reopen, exact replay/prune,
stale authority/proof/scope/final ACK, source/task late writes, task snapshot states,
raw SQL original immutability and event fencing, bounded/crossed commands and
scope-bound replies. Actual schema16 migration preserves existing schema root pages,
original rows, foreign keys and retained disk holds.

Review found crossed worker kind/payload variants; the corrected parser derives
payload shape from kind, with both raw crossed variants rejected. A source fixture
initially attempted staging after create claim; its corrected task-owned hook stages
before claiming, matching the production lifecycle without weakening its guards.

## Limits

The durable intent grants no read/producer drain, runtime removal, filesystem
inventory/deletion, physical ACK, purge or refund. C2b must share one bounded local
gate across actual owners and settle originals; C3-C6 remain separate. Legacy and
unadmitted reclamation need a later reviewed capacity/absence branch.
