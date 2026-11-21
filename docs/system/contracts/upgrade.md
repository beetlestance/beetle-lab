# Upgrade

How a ready installation moves to rebuilt images without losing state. The host
command in `tools/install/upgrade/` owns backup, fence, apply, activation and
rollback; the backend owns the fence it reads from the selector
(`app/src/bootstrap/upgrade-fence.ts`). Startup identity checks stay strict:
replay never re-pins ([installation](installation.md#offline-provisioning)).

## Command

`docker compose run --rm setup upgrade [prepare|status|activate|rollback]`
(`tools/install/upgrade/`) re-pins a ready installation to rebuilt images. It is an explicit
host command; normal startup never re-pins. Default action is `prepare`.

- Preconditions, checked offline before anything is written: both startup leases (a serving
  owner is `conflict`); the configured daemon; no live engine container or agent container
  (created-but-not-started is allowed); metadata schema 29 to current and Journal schema 26 to
  current, with no nonterminal runs, exports, executions, dispatch outbox rows, output
  deletions, output sources or slots, attempt ownership, Journal reservations, admission
  queue, attempts, delivery or staging. Unfinished input uploads, publications and deletions
  are not blockers: no process owns them while the services are stopped, so the sealed copy
  carries their rows and bytes, and the backend's startup recovery resumes or finishes them
  as after a restart. A migration that changes `input_blobs` converts such rows. Each blocker is named:
  `upgrade_blocked engine_containers,runs`. A pending [origin change](origin-change.md) is
  `upgrade_blocked origin_change`; the selector's `origin` field is carried unchanged. The request keeps the installation's baseline settings
  and policy ([decision 031](../../decisions/031-installed-defaults.md)). Nothing else may differ from it except the
  config schema digest of an installed identity with the same manifest, profile and catalog
  version (a compatible revision of the same schema `$id`; the Journal step approves it). Any
  other difference is `recovery_required`.
- Order: durable receipt `backing_up` (old and new image pins and schema versions) in
  `<home>/upgrade/receipt.json`; a cold copy of the whole root plus `bootstrap.sqlite`,
  sealed by the SHA-256 of its manifest (path, kind, mode, size, SHA-256 per entry), then
  `applying`; one atomic selector rename that sets the new pins as a generation together with
  `upgradeFence`; Journal profile approval; metadata migration; `awaiting_activation`. Each
  step is recorded and idempotent; a rerun resumes. Until the selector rename nothing in the
  root has changed, so a resume before it retakes the backup.
- While `upgradeFence` is set the backend refuses every mutation except browser-session
  exchanges, run/export cancellation, comparison and previews with retryable `503
  upgrade_pending`, before body parsing, so nothing is written; reads continue and
  `/health/ready` reports `not_ready` with reason `upgrade_pending`. Capacity changes refuse with `upgrade_blocked`. Releases that predate the fence
  refuse the selector outright, because their receipt capture rejects unknown fields.
- `activate` requires the selected configuration to match freshly inspected images, removes
  the fence and records `activated`; it is idempotent. Images that moved again refuse with
  `recovery_required`; roll back instead.
- `rollback` is allowed only before activation. It verifies the seal and installation
  identity, requires stopped containers and both leases, rebuilds the root from the backup
  beside it, compares the result with the manifest and swaps it in with two renames recorded
  under `rolling_back`; a rerun completes an interrupted swap. The old pins remain, so normal
  startup reports `upgrade_required` again. The replaced root stays under
  `upgrade/<operation>/replaced` for the operator to remove.
- `GET /api/v2/installation/upgrade` (`getUpgradeStatus`, read-only) reports the running
  release (`BEETLE_RELEASE`, else null) and metadata schema, the fence (`open` or `fenced` with the
  operation UUID), the rule `next_release_only`, unfinished runs, exports, uploads and removals,
  and the backup's lower bound (charged storage) against fresh agent free space, else unknown.
  The host phase and steps stay with `upgrade status`. Settings › Installation › Upgrade shows it;
  the web shell explains a refused action once. Beetle never checks for releases online.
- Not yet built: in-app activation, and a bounded health check of the candidate before
  `awaiting_activation` ([plan](../../plans/proposed/in-place-upgrade.md)).

Tests: `tools/install/test/upgrade-operation.test.ts`, `app/test/bootstrap/upgrade-fence.test.ts`,
`app/test/application/installation-status.test.ts`,
`app/test/storage/upgrade-schema029.test.ts`, `app/test/storage/upgrade-carried-inputs.test.ts`.

## Related

- [Installation](installation.md), [Recovery](recovery.md#upgrade-backup-and-rollback), [Resources](resources.md#offline-capacity-change)
- [Plan: in-place upgrade](../../plans/proposed/in-place-upgrade.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `tools/install/upgrade/` | `3841500b3847` |
| `tools/install/src/selection.ts` | `9567b14e41c3` |
| `app/src/bootstrap/upgrade-fence.ts` | `1c42b48f2278` |
| `agent/src/journal/cold-inspection/` | `5a89d6d464a1` |
| `app/src/adapters/outbound/sqlite/cold-inspection/` | `a17c6c4b650a` |
