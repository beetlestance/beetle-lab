# Durable output deletion progress

Status: first metadata owner; final purge/refund and producer retirement follow.
Owner: SQLite metadata worker and private OutputDeletionMetadata port. No public
DELETE route, automatic retention or cleanup scheduler is implied by this component.

## Eligibility and accounting

Begin one intent for an exact workspace/run/expected Run version. Admit only a
terminal run with either matching immutable source/absence finalization, released
execution and closed events, or a provably unsent terminal attempt with no execution,
outbox or output allocation. Unsent requires the single foundation-owned offered
attempt, null generation, exact retained execution intent and unsent cancellation
projection; missing or legacy rows alone never prove absence. output_pending remains1 by schema and is not a closure
flag. Source-backed intent captures all original published slots (<=128), their
versions, binding and source receipt pins. No mutation of immutable terminal Run.
Current model has no durable Run-result pin; suite/input revision pins stay unchanged.
A later producer/export pin must extend eligibility before being introduced.

The existing global scope/request receipt owns Begin replay before current-version
checks. New allocation ID/time are excluded from logical command intent. Different
request content conflicts. One intent per run prevents concurrent cleanup identities.
Progress versions are separate from immutable native deletion generation1.

Preserve ALL existing allocation, execution, source, event, payload and receipt rows.
No installation_storage_usage change, refund, tombstone or SQL data purge occurs.
Source settlement retains65,536+C(events/allowances)+M(manifest)+A(artifacts);
absence retains65,536+C+R(optional result). Native backend-file absence does not
establish agent-source/staging absence. No agent cleanup acknowledgement exists in
the current protocol; keep the original authority facts until that contract exists.
Files_absent means only every captured backend published slot has an exact receipt.
It never means the whole run is deleted or storage charges were released.

## Private operations and bounds

Begin/get return a <=4KiB summary: scoped intent/run/request identities, immutable
run/deletion generation, kind(source/absence/unsent), artifact/prepared/absent counts,
progress version, requested time and retained logical allowance components. Status
is pending or files_absent. Per-file get returns <=8KiB with the original owned
OutputFileRecord, progress version and optional stored namespace/preparation identity.
Never return all file records as one response. Requests <=12KiB; discovery <=64KiB.

File preparation/absence writes require exact scope/intent/ordinal and expected
file progress version. Parent must supply the ACTUAL returned native plan or absence
receipt; these private operations are never accepted from an HTTP/browser caller.
Bound/snapshot foreign JSON, compare the entire record/intent to captured metadata,
and persist returned commitments without recomputing them as evidence. The first
plan fixes the intent namespace; it cannot later change. Original published slot
versions remain pinned and immutable. Store only compact progress/commitments;
reconstruct the original record from retained verified source/slot owners.

Exact replay precedes progress-version checks. A different plan, namespace, record,
intent generation or absence receipt conflicts without changes. Absence cannot
precede stored preparation. Each first preparation and absence advances file and
intent progress once; repeated replies do not duplicate work or credit. A missing
acknowledgement is recovered from that same intent, not a replacement native token.

Discovery pages at most32 pending intents in monotonic sequence order with a closed
canonical cursor; completed backend-file progress leaves that lane. Each operation
owns one immediate worker transaction; no filesystem/network/engine work inside it.
Use the existing bounded worker queue and repeat capture on both sides of RPC.
Cross-scope intent/file lookups return not_found. Replies bind exact requested scope,
run/intent/ordinal and their semantic count/phase relationships before caller use.

## Reader exclusion and recovery

Committed intent excludes new artifact inventory/content metadata reads. Existing
native readers retain their token and block same-file preparation/removal until
physical settlement; native two-job/token admission remains authoritative. Result
and original source/receipt facts remain retained for recovery/producer retirement.
No byte is unlinked until its native preparation plan has committed. A preparation
write with unknown outcome is queried/replayed before native removal. The same
persisted plan recovers lost unlink acknowledgement and absent bytes after restart.

Native cleanup failure retains its job/lease; metadata progress cannot turn it into
an absence receipt. Lifecycle/runtime composition must retain native originals and
wait for their settled promise before releasing application admission. This owner
stores facts; the [bounded driver](output-deletion-runtime.md) supplies native
lifecycle. Public API/UI and producer retirement/refund remain separate.

## Acceptance

Real SQLite and actual worker prove Begin replay/version/scope/eligibility, zero-file
source/absence/unsent distinction, all captured slots, plan/receipt exactness,
namespace immutability, premature/stale/corrupt writes, bounded discovery, rollback,
reopen/lost reply and unchanged usage/source/events/allocations. Compose at least
one actual native prepared removal with stored progress. Existing source/absence
settlement and artifact-read scopes remain covered. Migration013 adds only this
owner; no old delete guards, accounting gates or tests are relaxed. Preserve failed
checks. No real data deletion, release image, Docker or native k6 claim.
