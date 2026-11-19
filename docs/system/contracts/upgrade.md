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
  current, with no nonterminal runs, exports, executions, dispatch outbox rows, input uploads,
  deletions, output sources or slots, attempt ownership, Journal reservations, admission
  queue, attempts, delivery or staging. Each blocker is named:
  `upgrade_blocked engine_containers,runs`. The request keeps the installation's baseline settings
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
  capacity_unavailable` (no `upgrade_pending` code exists in the API contract yet); reads
  continue. Capacity changes refuse with `upgrade_blocked`. Releases that predate the fence
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
- Not yet built: the in-app drain and activation UI, the backend upgrade status endpoint, a
  bounded health check of the candidate before `awaiting_activation`, and a dedicated
  `upgrade_pending` API code ([plan](../../plans/proposed/in-place-upgrade.md)).

Tests: `tools/install/test/upgrade-operation.test.ts`, `app/test/bootstrap/upgrade-fence.test.ts`,
`app/test/storage/upgrade-schema029.test.ts`.

## Related

- [Installation](installation.md), [Recovery](recovery.md#upgrade-backup-and-rollback), [Resources](resources.md#offline-capacity-change)
- [Plan: in-place upgrade](../../plans/proposed/in-place-upgrade.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `tools/install/upgrade/` | `a90fdf13b8d1` |
| `tools/install/src/selection.ts` | `9567b14e41c3` |
| `app/src/bootstrap/upgrade-fence.ts` | `347ef48487bc` |
| `agent/src/journal/cold-inspection/` | `5a89d6d464a1` |
| `app/src/adapters/outbound/sqlite/cold-inspection/` | `9cb07aa057fd` |
