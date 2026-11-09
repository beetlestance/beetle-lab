# Runner Offer byte bounds

Status: client, private HTTP, journal migration008, remaining consumers and
[launch contention](launch-contention.md) are integrated and locally verified;
see [storage intake](../../verification/storage-intake.md). Full-size loader/compile
passes; updated native containers and parallel stress remain unqualified.

## Independent limits

`contracts/src/limits.ts` owns RUNNER_MAXIMUM_CONFIG_BYTES=1048576 and
RUNNER_MAXIMUM_OFFER_BYTES=2097152. Limits measure UTF8 JSON bytes, not JS string
length. Config remains1MiB while the larger envelope holds identity, references,
budget and execution policy. Preserve JSON depth/node/collection bounds.
The already-parsed shared Offer validator checks the independent config byte bound
after structural schema validation, with fixed safe issues. This is structural
intake, not engine semantic compilation. Unknown object/file/HTTP intake must still
bound the complete Offer before traversal or allocation.

Only Offer intake increases. Existing other runner request/reply and Docker
transport/inspect/capacity limits remain. The HTTP client must choose an Offer
request allowance independently of its existing response allowance; caller-specified
smaller limits must remain effective. Do not widen the generic wire/API transport
default for this purpose. Raw HTTP/staged file size and normalized serialized JSON
are separate checks; whitespace/escaped Unicode do not increase normalized rights.
The wire registry snapshots shipped request-specific overrides at construction;
only the runner Offer selects2MiB. Response bounds retain their existing default.
An explicit caller maximum restricts both response intake and any request override.

## Propagation and ownership

Required consumers: runner client; private HTTP parser/request snapshot; catalogue;
installation enqueue; journal immutable snapshot/admission command/SQL read;
staging serialization and exact cost; Docker preparation; actual engine input loader.
Retain independent config/schema/compiler bounds. Admission commands containing an
Offer allow its2MiB plus bounded control overhead; non-Offer commands retain64KiB.
Explicitly bound canonical stored JSON too; do not assume character counts equal
bytes. Reordered-key dedup still binds complete original intent and secret references.

Acquire a dedicated two-Offer ingress allowance after authentication/scope/path
checks, before consuming/parsing bodies. No waiting queue. Retain ownership through
original enqueue completion even if the response/socket aborts. Parse/auth/413
failures without an enqueue original release exactly once. Close fences intake and
drains originals; it cannot certify cleanup from response completion alone.
Bound queued/in-flight large journal requests independently of its total32/64
request count and128MiB worker heap; cancellation/unknown commit cannot drop the
original owner. Demonstrate the retained-byte bound, not just a successful small run.
Known pre-issue readOffer queue_full must defer installation drive or return Stager
busy before file/provider work; it cannot abort a legitimate parallel run. Preserve
deadline/cancellation guards. Unavailable or unknown commit is never this refusal;
do not add automatic execution retries or reduce active-engine concurrency to two.

## Journal migration008

Keep applied migrations unchanged. In one FK-enforced transaction shadow-copy
accepted_attempts plus its four direct children: event_spool, admission_queue,
reservations and supervision_clock. Change only the two Offer/canonical2MiB checks.
Preserve every projection/checkpoint/cursor/charge/cancel field and indexes/uniqueness.
Drop children before old parent; rename shadow parent before shadow children.
Save and restore all three AUTOINCREMENT high waters, including missing sequence
rows for empty/deleted-high tables. No generation/queue order reset.
Require an empty foreign_key_check before commit and version8 only on success;
rollback leaves prior rows/schema/sequence/version intact. initialize runs007 only
for versions<7,008 for<8, and rejects versions>8. Preserve startup observation
invalidation. Verify fresh0 and upgrades1..7 plus reopen8.

Staging policy1 remains compatible: serialization format, fixed allowances and exact
charge formula do not change. Existing<=1MiB reservations retain their exact charge;
new larger offers pay their real bytes. Do not rewrite old charges, stamp policy2
or release charged records to accommodate a ceiling-only amendment.

## Acceptance

Shared validator tests independently measure exact1MiB mixed UTF8 config, one byte
over, escaped characters and invalid JSON structure. They do not qualify consumers.
An actual full-size k6 case must pass runner client -> private HTTP -> catalogue ->
installation/journal -> reopen -> Stager -> openStagedInput/compile, with independent
byte/hash expectations. Oversize config rejects before durable acceptance or provider
effects; raw2MiB HTTP acceptance/2MiB+1 rejection and oversized staged files are tested
separately. Preserve scoped identity, original replay and changed-intent conflict.

Migration tests use an independent literal v7 fixture with all children populated,
nontrivial fields and three elevated sequence high waters; compare exact preserved
rows/FKs/indexes, subsequent IDs and unchanged non-Offer/event limits. Inject late
migration failure and verify rollback/retry. Test ingress parser saturation, held
enqueue, disconnect/close and journal held originals at its byte/count boundary.
New source invalidates affected agent/engine image evidence; rebuild/qualify those
images before claiming native full-size execution. Parallel stress remains separate.
