# Plan: in-place upgrade

Status: partly built. Decisions taken 2026-11-17 and 2026-11-18: N−1 only; the
backend refuses a schema upgrade while nonterminal work exists; rollback is
limited to the window before activation; general mutable restore stays out of
this plan.

## Built (2026-11-18)

The host half now exists and is specified in
[upgrade](../../system/contracts/upgrade.md) and
[recovery](../../system/contracts/recovery.md#upgrade-backup-and-rollback):

- `docker compose run --rm setup upgrade [prepare|status|activate|rollback]`;
  normal startup with moved images refuses with `upgrade_required` and names it.
- Offline quiescence under both startup leases, with each blocker named
  (swap step 2's drained check, without the browser drain).
- A durable receipt with old and new image pins and schema versions, written
  before any change; an exact sealed cold copy of the whole root.
- Resumable, recorded steps: one atomic selector commit of the new pins plus
  the fence, Journal profile approval, metadata migration.
- The fence: the backend refuses mutations other than session exchanges,
  cancellation, comparison and previews; capacity changes refuse.
- `activate` lifts the fence; `rollback` before activation restores the sealed
  copy all-or-nothing, with an interrupted swap resumed. Tested with fault
  injection at each write, a populated schema-29 fixture migrated to current,
  and against a copy of a real schema-29/journal-26 installation.

Still open, so the sections below remain the plan for them:

- The in-app preflight, drain and activation interface, and the backend status
  endpoint the host would check in swap step 1.
- Swap step 4: starting the candidate and a bounded health check before
  `awaiting_activation`. Today the operator starts the stack after `prepare`
  and checks it before `activate`.
- A contract `upgrade_pending` error code; the fence returns
  `503 capacity_unavailable` until the closed API error set is amended.
- Release identity in the bundle (the upgrade compares image identities, not
  release numbers) and a recovery-control schema check.
- Rollback after failure is operator-initiated; nothing triggers it
  automatically. A Compose end-to-end upgrade in CI.

## Contract

### Who initiates

The administrator, in three deliberate steps: prepare (preflight and drain) in
the app, swap on the host, then activate in the app. The app never pulls images
or replaces its own containers: cold backup needs every service stopped and both
startup leases, which a serving process cannot hold
([recovery](../../system/contracts/recovery.md#cold-backup)).

### Where it runs

| Step | Runs in | Owner |
| --- | --- | --- |
| Preflight, drain, cancel | Backend, Settings › Installation › Upgrade | Administrator in the browser |
| Stop, cold backup, swap, migrate, health check | Host, `docker compose run --rm setup upgrade` from the new release bundle | Operator with Docker access |
| Activate | Backend of the new release | Administrator in the browser |
| Roll back (before activation only) | Host, `setup upgrade rollback` | Operator |

The new bundle carries the target release identity and pinned image digests for
frontend, backend, agent and engine. Its setup image performs the swap, so the
old release needs no knowledge of the new one.

### What "drained" means

Drained is the existing cold-backup precondition, entered on purpose:

1. Admission is closed by a durable maintenance fence. New runs, exports, input
   uploads and appends, publications, deletions and retention Apply return
   `503 upgrade_pending`. Reads and cancellation continue.
2. Every run is terminal and settled: none queued, dispatching, active or
   finalizing; no uncertain delivery or charged reservation.
3. Every export is `ready`, `failed`, `cancelled` or `unknown` with no
   publication pending.
4. Every input upload is finished or deleted: none in `staging` or
   `publishing`. Abandoned uploads are listed; they need explicit deletion.
5. No retention or deletion item is between `admitted` and `settling`.
6. No original I/O is outstanding: no held input reader, publisher, deletion or
   cleanup original, and no uncertain close (which is sticky and keeps the
   installation undrained).
7. The agent journal has no nonterminal attempt.

Draining never cancels anything. The administrator waits, cancels runs or
deletes abandoned uploads. Anything in an unknown state is listed by name and
keeps the installation undrained. Cancelling the upgrade lifts the fence.

### What N−1 guarantees

Release N declares exactly one predecessor release and its schema versions
(metadata `user_version`, journal version, recovery-control version).

| Guaranteed | Not guaranteed |
| --- | --- |
| N migrates the predecessor's exact schemas in one transaction each; tested on a fixture captured from release N−1 | Skipping a release, or any source other than N−1 |
| Settings, credentials, history, inputs, outputs, pins and retention policy survive | Restoring older writable state after activation |
| Backend, agent and engine come from one release; the runner protocol and installed identity refuse a mixed pair | Identical results from a newer engine image |
| The fence holds from drain through migration, health check and until activation; no user work is accepted in between | Viewing an older backup with a newer viewer (the viewer requires its exact schema) |
| Before activation, rollback restores the exact pre-upgrade backup (once built) | Survival of in-flight work (drain makes there be none) |

### Swap procedure

1. Verify the bundle and that the source is release N−1 and drained (backend
   status endpoint), then stop all services.
2. Re-verify drained offline under both startup leases; take and seal a cold
   backup.
3. Start the new digests with the fence still set. The backend migrates; the
   agent migrates its journal.
4. Health check: backend ready, agent capabilities, matching protocol and
   journal authority, within 120 s.
5. Pass: write receipt `awaiting_activation {from, to, backupPath}`. The new
   release serves reads only; the administrator reviews it and activates, which
   lifts the fence and records `activated`.
6. Fail, or the administrator chooses Roll back: the host tool stops everything
   and restores the exact cold backup in one operation — metadata database,
   journal, published input and output trees, installation configuration and
   recovery/installation control — then starts the previous digests. Receipt
   `rolled_back` with the cause.
7. Rollback fails, or a failure appears after activation: receipt
   `recovery_required`. Recovery is fix forward with a corrected N bundle.
   Restoring older writable state needs the separately deferred replay-protection
   design and is out of scope.

Pre-activation rollback is new mechanics: it must restore all parts together or
none, verify the backup seal and installation identity, refuse after
activation, and have its own failure tests. The existing read-only historical
restore cannot substitute for it.

## Interface states

The browser polls with backoff and treats a stopped backend as expected during
an announced upgrade. A disconnected browser never concludes success; only a
receipt read from a serving backend does.

| State | Shows |
| --- | --- |
| Preflight | Current release and schema; the path rule (the next release only; the app does not know its number); backup size against free space; counts of unfinished runs, exports, uploads and removals; "Prepare upgrade" |
| Blocked | Unknown states, abandoned uploads or not enough space, each named with a link |
| Draining | Fence banner on every page; live counts falling to zero; "Cancel upgrade" |
| Ready | Drained; the exact host command to copy; the fence stays |
| Upgrading | "Beetle is offline for the upgrade"; polls with backoff; after 10 minutes "Still offline", naming `setup upgrade status`; never a success claim |
| Awaiting activation | From → to, backup path, health result; "Activate 0.10" and the rollback command; the fence stays |
| Activated | Release active, new work open, backup kept |
| Rolled back | Previous release restored from the backup, cause, fence lifted |
| Recovery required | Host tool: failed step, backup path, fix-forward instructions; browser only "Still offline" |

## Evidence

An upgrade test per migration from the N−1 fixture; a drain test per admission
path, including uploads and outstanding originals; fault-injected rollback
before activation (each part restored, partial-restore refusal, refusal after
activation); a Compose end-to-end upgrade in CI (cost approved; needs push
authorisation).
