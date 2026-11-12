# Durable output deletion progress evidence

Status: locally verified metadata/native composition; runtime retention pending.
Source: feature commit containing this report, based on59c0ffe.
Contract: [durable progress](../design/lld/output-deletion-store.md).
No public DELETE route, scheduler, agent cleanup, quota refund or SQL purge.

## Exercised boundary

Migration013 adds scoped deletion intents and compact per-file progress. Begin is
one shared receipt-first transaction; exact replay excludes newly allocated ID/time.
Native immutable deletion generation1 is separate from progress versions. All
source, payload, event, execution, allocation, receipt and Run rows remain retained.
New artifact inventory/content reads are fenced by the committed intent. Historical
results/finalization replay remain available. No old guard or quota is relaxed.

Source/absence eligibility requires matching immutable settlement, released
execution and closed events. Unsent eligibility requires positive single-attempt
foundation ownership, offered state, null generation, exact retained intent and
an unsent cancellation projection. Missing legacy metadata does not prove absence.
The same unsent SQL witness is used by the operation and migration guard.

Each captured file is read independently, <=8KiB, with full original binding/slot.
The actual native preparation reply must commit before unlink. The first namespace
is fixed; original record/version/intent and all preparation commitments must match.
Exact replays cannot advance counts. Discovery is indexed, pending-only, <=32 and
<=64KiB with unique summaries and canonical forward cursors. RPC request/reply
capture occurs at both worker and caller seams before accepting success.

## Local checks

Metadata cases cover settled source/zero-file source, distinct absence/unsent,
128 captured slots, scope/ordinal/version, malformed commands/replies, changed
intent, premature absence, altered records/preparation, namespace mismatch, exact
replay, immutable SQL guards and artifact-reader exclusion. A focused review found
that missing execution rows alone initially admitted legacy terminal ownership as
unsent. A new regression reproduced that false acceptance before the shared
positive witness was added. Legacy, acknowledged and second-attempt ownership are
now rejected both by the operation and direct SQL guard.

Actual original schema001-012 is constructed for migration checks. Existing active
custody, charges, receipt rows and every old trigger remain unchanged after013.
An intentional late table collision rolls back the complete migration, schema
version and all original facts. Fixture corrections restored transaction boundaries
required by the existing payload migration and deferred custody foreign keys;
those failures remain recorded and no production gate changed.

The native composition publishes real files, finalizes metadata, then runs the
compiled worker. It persists ACTUAL native preparation replies, closes/reopens
metadata and the native namespace, loads the stored plan and removes its exact file.
After dropping the usable caller acknowledgement, the same plan recovers native
absence and metadata progress. One intent and one absent row per original file
remain, without duplicate progress. Independent SQL snapshots of the actual disk
DB before opening/after closing the exclusive worker show unchanged original rows
and storage charges. Results and immutable finalization replay remain usable.
The dropped reply is a simulated caller loss after a real commit, not TCP loss.

The initial disk snapshot incorrectly ordered a WITHOUT ROWID table by rowid; the
bounded corrected oracle sorts canonical rows independently. The corrected native
composition passed in7,425ms. Nine eligibility/migration cases passed in4,237ms after the
review correction; sixteen affected compiled-worker settlement/artifact cases
passed in13,434ms. Initial store/boundary lanes passed separately. Final Node
types passed in8,815ms, changed lint873ms, architecture5,296ms and docs555ms.
Commands/exits remain in scoped check-runner evidence; no broad suite, Docker
image rebuild, browser run or release qualification is claimed.

## Remaining authority

files_absent refers only to captured backend published files. Agent event ACK/prune
releases event custody but is not source/staging cleanup acknowledgement. Existing
immutable producer facts and ALL charges must remain until that separate authority,
final purge/refund and replay/tombstone contracts exist. A bounded lifecycle driver,
public API/UI, automatic retention and cancelled unknown-output cleanup remain.
No real-user bytes or existing services were changed by these task-owned fixtures.
