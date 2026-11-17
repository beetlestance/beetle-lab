# Plan: in-place upgrade

Status: proposed. Decisions taken 2026-11-17: N−1 only; the backend refuses a
schema upgrade while nonterminal work exists. Not built. Today migrations run at
startup, but only cold backup and fresh read-only restore are claimed.

## Contract

### Who initiates

The administrator, in two deliberate steps. The app prepares (preflight and
drain); the operator runs the swap on the host. The app never pulls images or
replaces its own containers: cold backup needs every service stopped and both
startup leases, which a serving process cannot hold
([recovery](../../system/contracts/recovery.md#cold-backup)).

### Where it runs

| Step | Runs in | Owner |
| --- | --- | --- |
| Preflight, drain, cancel | Backend, from Settings › Installation › Upgrade | Administrator in the browser |
| Stop, cold backup, swap, migrate, health check, revert | Host, `docker compose run --rm setup upgrade` from the new release bundle | Operator with Docker access |
| Result | Backend reads the upgrade receipt on start; the browser shows it | Both |

The new bundle carries the target release identity and pinned image digests for
frontend, backend, agent and engine. Its setup image performs the swap, so the
old release needs no knowledge of the new one.

### What "drained" means

Drained is the existing cold-backup precondition, entered on purpose:

1. Admission is closed by a durable maintenance flag. New runs, exports, input
   publications, deletions and retention Apply return `503 upgrade_pending`.
   Reads, cancellation and settings reads continue.
2. Every run is terminal and settled: none queued, dispatching, active or
   settling; no uncertain delivery or charged reservation.
3. Every export is `ready`, `failed`, `cancelled` or `unknown` with no
   publication pending.
4. No retention or deletion item is between `admitted` and `settling`.
5. The agent journal has no nonterminal attempt.

Draining never cancels anything. The administrator waits or cancels runs. A
`blocked` item (unknown state that will not settle by itself) keeps the
installation undrained and is listed by name. Cancelling the upgrade clears the
flag and reopens admission.

### What N−1 guarantees

Release N declares exactly one predecessor release and its schema versions
(metadata `user_version`, journal version, recovery-control version).

| Guaranteed | Not guaranteed |
| --- | --- |
| N migrates the predecessor's exact schemas in one transaction each; tested on a fixture captured from release N−1 | Skipping a release, or any source other than N−1 |
| Settings, credentials, history, inputs, outputs, pins and retention policy survive | Downgrade after the migration commits |
| Backend, agent and engine come from one release; the runner protocol and installed identity refuse a mixed pair | Identical results from a newer engine image |
| A failure before the migration commits leaves the source unchanged and revertable | Viewing an older backup with a newer viewer (the viewer requires its exact schema) |
| A backup taken in the same operation is sealed before anything changes | Survival of in-flight work (drain makes there be none) |

### Swap procedure

1. Verify the bundle and that the source is release N−1 and drained (backend
   status endpoint), then stop all services.
2. Re-verify drained offline under both startup leases; take a cold backup.
3. Start the new digests. The backend migrates; the agent migrates its journal.
4. Health check: backend ready, agent capabilities, matching protocol and
   journal authority, within 120 s.
5. Success: write receipt `{from, to, backupPath, completedAt}`; the backend
   clears the maintenance flag on its first start under N.
6. Failure before any migration committed: restart the previous digests;
   receipt `reverted` with the cause. The old release reopens admission.
7. Failure after a migration committed: stop everything; receipt
   `recovery_required`. The old release refuses the newer schema, so revert is
   impossible. The operator either fixes forward with a corrected N bundle or
   restores the backup into a fresh root (needs mutable restore, not yet built).

## Interface states

| State | Shows |
| --- | --- |
| Preflight | Current release and schema; the path rule (N−1 only); backup size estimate against free space; count of nonterminal runs, exports and cleanup items; "Prepare upgrade" |
| Blocked | Preflight found work in an unknown state, or not enough space; each blocker named with a link |
| Draining | Admission closed banner on every page; live counts falling to zero; "Cancel upgrade" |
| Ready | Drained; the exact host command to copy; admission stays closed |
| Upgrading | Backend unreachable during an announced upgrade; the browser waits and polls |
| Success | From → to, backup location, "Admission reopened" |
| Reverted | Previous release restored, cause, admission reopened |
| Recovery required | Shown by the host tool, and by the browser if it was open: backup path and the two recovery options |

## Evidence

An upgrade test per migration from the N−1 fixture; a drain test per admission
path; a Compose end-to-end upgrade in CI (cost approved; needs push
authorisation); a fault-injected migration failure that ends `reverted`.
