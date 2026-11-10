# Agent disk retention accounting

Status: accepted implementation contract and scalar types; journal/policy wiring
and its independent acceptance remain required before this feature is implemented. Scope: logical disk promises retained after execution release.
This is not a source manifest, deletion API or physical filesystem quota.

## Private interface and limits

`DiskRetention` in agent/admission has required scalar heldCount, outputBytes and
stagingBytes. Bytes count retained originals only; count includes active and retained
holds. Values are exact nonnegative safe integers, count<=4096. Zero count requires
zero retained bytes. Capture closed original data fields before encoding; never
infer zero for unavailable state. The compact reply is at most256 JSON bytes.

The root-approved policy amendment is exactly
`decideAdmission(candidate, snapshot, retention: DiskRetention): Decision`.
The new argument is required; no optional/default-zero compatibility path. Both
journal offer/admit callers load actual facts in the same transaction as their
existing snapshot. Existing replay paths return before new admission checks.
The current two-argument implementation changes only with its actual callers.

One hold is reserved per actual admitted original, not per queued Offer. Hold count
4096 is a control-service outstanding-native-custody ceiling, not a backend history
limit. Fixed512-byte metadata reservation covers the bounded hold identity/amount/
phase row and logical row allowance. No source-record charge is reserved yet;
that later contract must declare its exact bytes and quota failure behavior.

## Immutable hold and counters

Coordinator reserves agent journal migration011 for this boundary only. No backend
migration or generated HTTP schema changes are authorized by this page.

| Owner | Exact stored facts |
| --- | --- |
| disk_holds | attempt_id PK/FK reservation; organisation/workspace, generation1, original intent digest; output_bytes, staging_bytes; metadata_bytes=512; phase active or retained |
| disk_retention_stats | singleton id1; held_count; held_output_bytes, held_staging_bytes across ALL holds; retained_output_bytes, retained_staging_bytes across retained holds only |
| accepted_attempts | hold_bytes=0 or512, exactly matching presence of its hold |

Hold amounts match the admitted immutable reservation resources/budget/staging
estimate and original scope/intent. New holds cannot adopt current profile values.
Insert the hold/count/charge atomically with reservation creation and admitted
event; rollback leaves none of them. Existing exact replay adds nothing.

All-held totals and retained totals must be exact safe integers; all-held totals
ensure later release cannot overflow. Each per-original amount retains existing
MAX_RESOURCE_VALUE bounds. SQL protects identity, amounts and metadata from UPDATE,
REPLACE and DELETE. Hold phase follows reservation charged1/0; no contradictory
state may commit. Singleton counters cannot be manually reset or forged.

## Release and abort

In the transaction changing charged1 to0, move BOTH original output and staging
amounts into retained totals once and change active to retained. Keep held count
and all-held totals unchanged. Cover releaseSettled and abortUnstarted, including
replay/lost-reply paths. No filesystem/network work occurs in that transaction.
Failed collection retains unknown files without inventing a verified manifest.

Retirement closes process owners, not file absence. Input/secret/output staging may
exist before runtime creation; abortUnstarted cannot refund either disk amount.
CPU/RAM/PIDs, concurrency and isolation are released under their existing proofs;
retained disk holds do not keep an execution active or isolated. Physical failed/
over-limit files may exceed logical promises; this is not a hard output quota.

No refund/deletion/settlement method exists in this first accounting step. Later
cleanup must prove scoped file absence and reader/writer quiescence before releasing
holds. Event ACK/prune, terminal state, retention preview or missing generic404 are
not that proof. Backend output allocation remains independently charged.

## Admission arithmetic

Let A be summed ACTIVE resources, C the candidate and R the retained disk vector
(outputBytes/stagingBytes, all other dimensions zero).

- Intrinsic profile/per-run validation still uses C and the original effective pool.
- Logical pool fit tests A+C+R. Pass the same retained usage into existing fairness;
  nonpromoted predecessors fit with A+R, while existing promotion rules remain.
- Only active reservations count for CPU/RAM/PIDs/concurrency/isolation.
- A full held-count ceiling defers new admission with retention_capacity. Disk pool
  pressure defers with budget_unavailable, never intrinsic impossible_request.
- Native freeDisk already excludes retained files. Preserve the conservative future
  write test A.output+C.output+A.staging+C.staging<=freeDisk-overhead. Do not add R
  again or subtract guessed active file occupancy.

Use subtractive comparisons when R exceeds a configured pool or A+C+R would exceed
safe integer range. Such representable debt defers; do not throw/round/clamp it into
apparent free capacity. New admission reserves a hold slot only after policy fit.
Lower settings preserve existing promises and drain; replay stays available.

## Journal quota and migration

Add hold_bytes to every spool/snapshot/checkpoint quota preflight and SQL constraint;
ACK pruning never refunds it. A hold insert that cannot fit the existing original
journal quota fails atomically, without partially admitting or expanding quota.
Normal admission/discovery reads compact counters, never released-history payloads.
Counters may be checked against the bounded<=4096 hold rows in SQL guards, without
materializing Offer configurations or history into Node.

Chosen upgrade policy: migrate conservative holds for ALL existing reservations,
including released/aborted originals. Require trustworthy bounded original amounts
and identities; do not guess unknown staging as zero or create source receipts.
If count, all-held integer totals, per-original quota or needed identity facts
cannot be represented, fail the migration atomically with journal unavailable.
Keep the old schema/data untouched and document cleanup with the prior binary or
consistent backup recovery; do not prune/refund/clamp to get an upgrade through.
Lower CURRENT pool ceilings alone are not a migration failure: preserve that debt
and defer new admission. Legacy journal UUID quarantine remains unchanged.

## Acceptance and next boundary

Required: concurrent byte/count limits, exact replay, release/abort/lost reply and
late transaction rollback, lower pools, retained-only workloads freeing CPU and
isolation, fairness under retained pressure, native freeDisk without double charge,
staging-before-abort, malformed/hidden carrier fields and safe-integer debt.
Inspect actual rows/counters independently; test SQL direct mutation/REPLACE/delete
and FK guards. Test migration exact-fit/overflow/quota/missing-fact failure leaves
old data/version unchanged. Source result/retention bytes must not be inferred from
returned success or fabricated collection facts.

Durable verified source observations, digests, source-byte quota, matching-receipt
finished-release gates, transfer and cleanup remain the next contracts. Existing
finished release behavior is not labeled source-verified by this accounting step.
