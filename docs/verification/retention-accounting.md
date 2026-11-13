# Retention snapshot accounting

Status: private metadata reservation and durable workspace epochs implemented;
selection, expiry/apply, worker/public API and UI remain pending. No retention job
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

These are synthetic SQLite/compiled-build checks. No new public mutation, Docker run,
registry publication, user-data deletion or hosted-access claim is made. Expiry and
Apply must preserve charged unfinished progress, reject stale/expired membership and
use the existing receipt-first Begin/cleanup driver before exposing this capability.
