# Protected run retention

Status: implementation in progress. This page owns public selection and admission;
[output deletion](output-deletion-store.md) and [settlement](output-settlement.md)
own native cleanup, recovery and actual logical credit. Changing a policy never
starts deletion. Manual policy is the default.

## Selection unit

Evaluate one workspace independently, newest first by immutable requestedAt and ID.
Retention inherits installation → organisation → workspace as one policy leaf.
Capture all three settings IDs/versions and the effective policy/source. Parent
operations traverse workspaces with a bounded durable cursor; they must report
continuation/partial coverage rather than combine workspace counts or budgets.

One preview turn evaluates at most100 Run headers using a matching index, plus
one header-only existence probe.
Carry completed count and retained logical bytes from the preceding window; browser
counters are never trusted. Exact prefix state belongs to the stored previous page.
A page may contain no candidates and still have a continuation. No OFFSET, unbounded
materialization, whole-history aggregate/window query or per-request directory walk.

Rules are a union, reported in age/count/storage priority:

- Age compares immutable requestedAt against the captured preview time minus ageDays.
  The current Run model has no completion timestamp. Active work is always excluded.
- Count selects completed runs beyond the newest completedRunCount prefix.
- Storage selects the older tail whose completed-run logical debt prefix exceeds
  storageBytes. It is a per-workspace history budget, not an installation disk quota.

Protected completed runs still consume count/known bytes. Unknown completed byte
amount poisons storage selection for the older prefix; never substitute zero.
Independent age/count rules may still select another positively eligible run.
Permanent replay floors, global mutation receipts, revisions and referenced inputs
are outside reclaimable history bytes. Preview estimates never mean freed space;
protected/unreclaimable debt may prevent reaching the requested budget.

## Protection and stale checks

Every selected original must pass the existing positive source/absence/unsent
eligibility check, exact terminal/outcome/version checks and current custody rules.
Active, pinned, unknown and cleanup-in-progress work is excluded. Missing rows,
terminal state alone, timeout or404 never establish cleanup eligibility. Inputs and
suite revisions are not deletion candidates. No durable Run pin currently exists;
any pin affordance needs durable pin/protection handling before being exposed.

A workspace-owned epoch survives Run deletion and advances transactionally for
selection-relevant Run/pin/deletion mutations. Epochs never reset on purge. Capture
it with the page in the same immediate transaction. Continuation rejects changes to
the epoch or any captured settings version; restart preview instead of combining
old/new prefixes. Application likewise revalidates the captured scope, settings,
epoch, every candidate version and authoritative eligibility before any Begin.

Pages are immutable once committed. Candidate IDs/versions/membership/reasons and
estimated bytes cannot be edited by Apply. One successful application atomically
begins all captured candidates, at most100, using the existing receipt-first Begin
owner with captured stable request/deletion IDs. All revalidation precedes mutation;
capacity/protection/stale failure rolls back the whole admission. No network/native
work occurs in this transaction. The existing bounded cleanup driver does the work.

Exact successful Apply replay precedes current stale checks. The successful batch
invalidates subsequent continuation; users preview the remaining history afresh.
An admitted receipt means work was accepted, never that files or charges are gone.

## Snapshot storage contract

Logical reservation per page131072 bytes, maximum8 live pages globally.
First preview in a workspace also charges a permanent512-byte epoch row. That row
survives Run/snapshot purge; snapshot expiry never refunds it. No legacy row backfill.
Reserve against actual authoritative installation charged usage and persisted
storage allocation/free-space reserve in the same immediate transaction. No presumed
free metadata allowance or invented runtime observation. Saturation fails explicitly;
never evict an applied page that still owns unfinished cleanup progress.

The strict snapshot/progress codecs and maximum-width tests establish this format
budget. Persistence must enforce the same bounds before schema acceptance:

| Representation | Upper bound |
| --- | ---: |
| Canonical policy/settings/member snapshot body |32768 |
| At most100 progress rows,256 body+512 row allowance each |76800 |
| Snapshot header, cursor and request/reply allowances |8192 |
| Total |117760 |
| Reserved logical bytes |131072 |

These are logical allowances, not SQLite file/page/WAL or secure-erasure guarantees.
Boundary validators, SQL checks and maximum-width tests must enforce each bound.
Live preview requests replay within a15minute lifetime. Explicit continuation may
consume an empty unapplied predecessor, copying its stored prefix into the newly
funded child in the same transaction. This bounds empty-history traversal to one
slot. Candidate-bearing pages are never consumed by continuation. Consumed pages
lose replay availability; a fresh preview still needs explicit Apply. Missing,
consumed or expired snapshot IDs
refuse Apply; expiry cannot create another destructive identity. Unapplied expired
snapshots can be removed in a bounded sweep of the eight owned slots and refund
only their own exact metadata charge. Applied pages remain charged through pending
or unknown cleanup, even beyond expiry. Completion records the immutable first observed time from the persisted clock
high-water mark after every member has its exact permanent settlement. Completed
pages may expire15minutes after that observation; explicit acknowledgement may
remove them sooner. Removal loses batch replay/status availability; missing IDs
always refuse Apply. Run/agent permanent anti-replay floors remain independent.

Apply progress retains each captured deletion identity. Reads distinguish admitted,
backend-file progress, stored agent cleanup ACK, permanent settlement and unavailable
or failed work. A run disappearing without its exact settlement is an error, not a
successful deletion. Derive progress from bounded authoritative owners; any retained
error uses a fixed code/phase, never arbitrary logs, paths or credentials. Existing
native jobs keep custody after cancellation or failed close.

## Delivery slices and acceptance

1. Bounded pure rule windows: exact boundaries, protection, unknown storage, manual,
   continuation equivalence and overflow refusal. No persistence authority.
2. Charged snapshot/epoch metadata, immutable membership and atomic admission:
   scope, quota/full pool, stale settings/Run/pin, replay, rollback and restart.
3. Public workspace/manual endpoints and bounded parent traversal; generated clients,
   authentication, cross-scope checks and actual compiled-worker/TCP recovery.
4. Current provisional UI: inherited policy, preview/continuation, explicit apply,
   honest progress/errors and no optimistic freed-byte claims.
5. One composed synthetic cleanup run, lost response/reopen and retention recovery.

Backend migration025 is reserved for this owner. Agent schema/cleanup contracts do
not change. Source-bound scoped checks and independent review precede integration;
no user data, user target, registry publication or UI redesign is authorised here.
