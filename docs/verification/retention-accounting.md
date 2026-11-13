# Retention snapshot accounting

Status: private metadata reservation and durable workspace epochs implemented;
worker/public API and UI remain pending. No retention job
is enabled by this slice. [Contract](../design/lld/protected-retention.md).

Backend025 creates empty owned tables/counters without backfilling old originals or
claiming storage credit. A first preview pays131072 snapshot plus512 permanent epoch
bytes against the actual persisted installation allocation/free-space reserve. Later
pages pay131072; maximum8 live pages. An O(1) counter and successful funding clock
remain exact. Lower capacity preserves existing charged pages and exact live replay.

The private synchronous frame binds exact scope/body, insert phase and both counter
transitions. SQL cannot create that frame. Old owners are frozen during funding;
raw replacement/refund and nested global/original writes fail. Any late write failure
rolls back the epoch, page, clock and entire charge together. No physical-free-space
or SQLite-file-size claim follows from these logical allowances.

Run insert/update/delete and cleanup-intent admission advance existing workspace
epochs. Epochs survive Run purge. Settlement captures the actual old epoch, permits
only its original workspace’s old→old+1 while purging Runs, and verifies the resulting
value before credit. An absent epoch remains absent. Historical024 SQL is unchanged.

Scoped evidence retained privately under `.agent-work/retention-accounting/`:

- 26 behavior/migration cases passed, including actual populated24 upgrade and late
  migration rollback, charged identity reopen, capacity/full slots, stale policy/epoch,
  funding rollback and unchanged unrelated owners.
- Actual settlement with an epoch retains both prepaid debts and replays once;
  wrong phase, duplicate/other-workspace mutation, actual epoch-write failure and
  near-limit refusal preserve all original rows/charges on rollback.
- After a behavior-preserving guard/fixture extraction,11 affected cases, Node types,
  lint, architecture, docs and backend build passed. Remaining prior green cases were
  reused against unchanged relevant source.
- Independent review found no blocker. Initial fixture capacity and unused-import/lint
  failures are retained; no production accounting failure was hidden.

These are synthetic SQLite tests and a backend build. No new public mutation, Docker run,
registry publication, user-data deletion or hosted-access claim is made. Expiry and
Apply must preserve charged unfinished progress, reject stale/expired membership and
use the existing receipt-first Begin/cleanup driver before exposing this capability.

## Preview expiry

Maintenance persists the latest observed clock and processes at most8 owned previews.
Only an exact unapplied expired page can be removed; its131072 charge is refunded
once while the workspace epoch’s512 remains. Every applied page stays protected,
even if progress is missing. Clock rollback cannot revive a consumed expiry.
A failed late credit or nested different-page deletion rolls the whole operation back.

Ten expiry/accounting cases and three migration cases passed, followed by types, lint,
architecture, docs and backend build. Review found no blocker. The clock is limited
to canonical24-character UTC dates so year10000 cannot break lexical expiry ordering.
Applied completion pruning and public maintenance scheduling remain pending.

## Workspace selection

The private workspace selector uses the scoped requested-time/ID index, at most100
evaluated Runs plus one header-only probe. Source/absence/unsent eligibility and
funded cleanup control must agree with actual retained debt before candidacy. Active,
unknown and cleanup-in-progress originals remain protected; unknown debt disables
the older storage prefix. No Run pin affordance is introduced by this component.

Continuations use only the scoped stored predecessor’s prefix/cursor and revalidate
epoch, all settings versions, effective policy and source. A live request replay
returns immutable membership before fresh settings/capacity checks. Continuation may
atomically consume an empty, unapplied predecessor and fund its child; it never drops
candidates or progress. This permits more than eight empty windows without exhaustion.
Consumed/expired snapshot IDs cannot be applied. Parent traversal remains separate.

Focused tests cover11 successive windows with one live slot, live immutable replay,
stale/cross-workspace/forged cursors, positive source and unsent debt, unknown proof,
existing cleanup and the indexed keyset path. Selection has no native effects and
does not enable public Apply.

## Atomic workspace Apply

Apply preflights all captured members before the closed fixed executor begins any
intent. Existing intent preparation and global child receipts are shared with normal
Begin. Only exact child intent/file/receipt inserts and expected workspace epoch
increments are authorised; unrelated owners are frozen. Actual rows/receipts and
bounded SQLite sequence state are verified before storing initial progress and
marking the snapshot applied. All failures roll back the whole batch.

An admitted receipt means no cleanup or credit. Successful replay binds original
scope/snapshot/request/canonical intent before expiry or current-policy checks.
Changed reuse conflicts. Snapshot storage remains charged; progress starts admitted.
Live batch request IDs cannot be reused for another metadata mutation.

Thirteen focused Apply cases passed, including source-backed files, maximum100
members, unchanged usage, replay after expiry/settings changes, nested global/peer
mutations, raw sequence tampering and late-child/final-state rollback. The scoped
regression lane, types, lint, architecture, docs and backend build passed. Independent
review found no blocker. Compiled-worker Apply reply-loss recovery is qualified; public HTTP/UI composition remains pending.

## Durable completion and metadata removal

Status derives actual backend-file counts, stored cleanup ACK and validated permanent
settlement for each captured child. It binds scope, deletion ID, original Run version
and exact refund. Stored progress text never grants completion. Unknown/malformed
evidence is blocked and retained. Partial settlement reports only its actual credit.

A closed frame records the first observed completion time once, using the persisted
clock. Completed status/Apply replay remains available for15minutes after observation.
Expiry or explicit acknowledgement revalidates every permanent proof, then atomically
deletes only owned progress/header records and refunds131072. Epoch512 and all run
replay floors remain. Pending work cannot be discarded. Removed IDs refuse Apply;
no membership or receipt is reconstructed from caller data.

Progress/completion/expiry cases passed, including partial/source-file stages, proof
version mismatch, phase forgery, exact observed time, completed-page credit and late
progress-delete/completion-owner rollback. The scoped regression lane, types, lint,
architecture, docs and backend build passed. Independent review found no blocker.
An applied page remains charged until completion is observed; public composition
will supply that observation. No native or physical-free-space claim is added.


## Worker and manual selection

Closed bounded worker calls expose workspace/manual previews, atomic Apply, scoped
inventory, original preview recovery, status and acknowledgement. Manual deletion
requires the same positive eligibility and exact Run version before reserving a
single immutable candidate. All paths share the existing Apply and cleanup driver.
Inventory is at most eight charged headers, with no inferred native progress.

Real compiled workers recovered committed Apply/manual-preview reply loss across
termination and reopen. A forged reply remained pending until actual termination
joined. Scoped manual/quota/isolation and inventory cases, types, lint, architecture
and backend build passed. Public workspace/manual routes and generated clients passed394 scoped behavior
cases across34 files, including authenticated guards, cross-scope refusal, a dropped
real TCP Apply response, fresh worker reopen/replay, original preview recovery,
settlement-derived credit and explicit acknowledgement. Removed IDs refused further
status/Apply/discard; no second credit was inferred. Client cases rejected forged
identities, duplicates and false completion. Type checks, lint, architecture, docs,
API generation and backend build passed; independent review found no blocker.
Provisional workspace settings and terminal Run controls now expose inherited
policy, immutable preview/continuation, explicit Apply, durable batch recovery,
settlement-derived progress and explicit acknowledgement. Unknown mutations retain
one UUID/body for explicit replay; retirement aborts and fences callbacks. Shared
bounded read admission coordinates panels without increasing worker limits.

327 affected UI/Run/settings cases passed. A test-fixture-only complexity correction
passed its seven affected cases; web types, lint, architecture, docs and web build
passed. Independent review found no blocker. Browser visual inspection was unavailable
because no browser execution tool was exposed; no visual qualification is claimed.
Parent traversal, driver diagnostics and composed retention-native qualification remain.
