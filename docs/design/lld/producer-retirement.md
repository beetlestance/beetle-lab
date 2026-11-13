# Durable producer and reader retirement

Status: C2a durable metadata and C2b shared lease gate implemented locally. The
C2c whole-producer barrier/coordinator below remains proposed. No cleanup endpoint,
file removal, ACK or refund.
Parent [retirement](output-retirement.md), [namespace](staging-namespace.md) and
[control capacity](cleanup-control.md). Root reserves agent Journal migration017.

## Request and durable authority

A shared closed OutputRetirementRequest is protocol1/performance and <=3072 UTF-8
bytes (4096 transport frame before allocation). It carries exact organisation,
workspace, attempt, generation1, intentDigest and physical Journal authority;
canonical backend Run/deletion UUIDs and deletionVersion1; and one closure:

- source: sourceDigest, manifestDigest and finalAgentSeq;
- absence: canonical proofDigest and finalAgentSeq.

These fields reconstruct the existing exact SourceReceipt identity or bind the
stored OutputAbsence. The agent compares the committed source/delivery or absence
fact and requires acknowledged sequence to cover that same immutable final end.
Caller supplies no path, native facts, artifact list, quota or quiescence flag.
The shared request schema/codec lives in contracts/output-retirement; no runner
route is added by C2. Run/deletion IDs are authenticated backend bindings pinned by the first intent;
Offer has no Run ID, so agent storage cannot independently reconstruct that mapping.
Request SHA256 uses one shared bounded canonical codec and injected digest function.
Absence digest remains SHA256 of the existing canonical2048-byte proof.

Reserve the bounded local entry before any Journal call. Read-only preflight uses
the same eligibility validator as begin, so malformed/stale/active requests reject
before fencing producers; begin revalidates atomically and never trusts preflight.
Begin transaction requires performance purpose, original/closure/authority match,
a definitively released admitted reservation, installed C1 namespace and control
version1. Rejected/unadmitted originals remain outside this C2 branch.
Source-backed requests require a prepared task anchor, matching source output-root
facts and claimed spec digest. Absence may snapshot no-task/preparing/prepared
metadata, which still grants no file-removal permission.
Persist one immutable request/digest, namespace identity and observed task metadata
state/anchor identity, <=4096 bytes including the record wrapper. Fixed SQL row
allowance comes from C1's separate control bucket. No payload double charge or
reserve increase. Exact replay returns the same intent; any changed request conflicts.
No drained/native-absent state is inferred or persisted by this transaction.

Unreserved old/unadmitted rows refuse retirement with recovery_required. A prepared
anchor is retained; preparing/no-task metadata may be fenced but gives C3 no native
permission. Partial task roots stay charged and require recovery. The later no-task
and unadmitted reclamation branches need their own reviewed capacity/absence policy;
C2 does not silently enable them or change the1024-byte offered path.

SQL guards fence new admission, task preparation, launch claims/dispatch, collection
and source publication after intent. Immutable observation/replay and necessary
read-only closure/reconciliation remain available. Reopening uses the durable gate;
no in-memory empty owner restores execution authority.

## One local gate, real originals

One explicit gate per Journal is shared by installation, Stager and output reader;
composition must supply it, with no permissive production fallback. It owns at most
64 scoped entries/retirement originals; source service retains its existing global
two-operation credit. Acquire a read lease synchronously before the first await,
then check the durable gate and local fence again before native work. Lease release
requires actual original settlement; a timeout or abort cannot release it early.

C2b reserves each bounded original slot before invoking its factory. A poisoned
factory/quiescence/close fences its scope and retains the original plus service
credit. Shutdown waits actual leases; unknown cleanup refuses Journal/runtime owner
release. A preflight reservation leaves intake open until its explicit fence. Exact
positive confirmation rereads the immutable Journal intent before local eviction.

C2c must add one fixed monotonic budget (<=30s) starts before preflight and covers begin,
reconciliation, producer/read drain and cold inspection. Expiry is observable as
expired/fenced; it cannot release issued originals/credits or mint a late C3 token.
Drain/cached-close ownership continues after expiry. A new budget is possible only
after the prior carrier/drain has actually settled, with fresh stopped inspection.

Coordinator fences the local gate before awaiting begin. Once begin is issued,
a failed/unknown commit never reopens local intake in C2, even if a status read
finds no row. Durable absence cannot exclude an earlier still-committing original.
Retain that original carrier and fence through actual settlement/termination.
Journal exposes retirement-specific carrier settlement: a healthy replied/refused
call is finished; a failed worker must await its original termination promise.
Only after that barrier may exact status reconcile the result. Missing intent then
can establish rejection; a positive exact intent can continue within the original
budget. Uncertain/rejected carrier termination stays fenced and requires recovery.
No missing read, lost reply or timer supplies carrier settlement. Prior leases drain; future
leases reject. Each range factory/result/quiesced/cached-close original stays
strongly owned. Factory uncertainty or rejected close is sticky and refuses drain;
service rejection alone must not discard that owner. HTTP request/response/socket
credits remain independently owned by the existing transport.

Installation fences and drains its actual entry leases, preparation/providers,
watch callbacks, cancellation chain and controller closes. A recovered original
requires the existing Supervisor released-runtime retirement/inspection path;
never create an empty controller as proof. Unknown/running/foreign runtime or
rejected close remains unresolved. No target create/start retry occurs.

A successful process-local barrier binds exact request, namespace and task snapshot.
It is an unforgeable local capability for C3 preconditions, not a serialized cleanup
receipt. After restart reestablish actual producer/read ownership and current stopped
runtime inspection. A stored intent or earlier local success cannot manufacture it.
C3 separately owns exact runtime removal permission and native plan/removal/absence.

Once commit is known and actual originals have drained successfully, an empty local
entry may evict; an expired barrier grants no capability, and retry re-inspects.
A later read still acquires a lease and fails the durable gate before IO. Never
retain an unbounded in-memory tombstone list or evict failed/held originals.

## Acceptance

Compiled Journal lost-reply/reopen, scope/authority/closure/ACK mismatches, raw SQL
late-write guards and unchanged quotas; actual held range result/quiescence/close,
sticky rejected close, read-start/retire races, late source/drive refusal and real
existing/cold producer barriers. Bounded entry/credit/control caps and no repeated
target side effects. Matching components qualify the composed source once; C3–C6
and public retention remain unavailable.
