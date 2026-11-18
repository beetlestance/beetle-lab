---
title: Upgrade an installation
description: Move an installation to rebuilt images with the offline upgrade command, check the new version, then activate it or roll back.
sidebar:
  order: 8
---

An installation is pinned to the images it was set up with. When you rebuild the
images, for example after updating the checkout, normal startup refuses to move
to them and the `setup` container stops with:

```text
upgrade_required
Images moved: stop services, then run `docker compose run --rm setup upgrade`.
```

The backend and agent wait for `setup` to succeed, so they do not start. Nothing
has changed yet. The offline upgrade moves the installation to the new images in
deliberate steps: back up, migrate, check, then activate or roll back.

:::caution[What is not built yet]
- Only the previous release can be upgraded (N−1). An installation older than
  that refuses with `recovery_required`; skipping releases is not supported.
- Nothing checks the new version for you or rolls back on its own. You check it
  and you decide.
- There is no free-space check. The backup is a full copy of the installation,
  so make sure the disk holds that much again before you start.
- There is no upgrade screen in the app yet; everything happens on the host.
:::

## Before you start

Let every run, export and upload finish, or cancel them, then stop the services.
The upgrade checks offline, before it writes anything, that nothing is in
progress. If something is, it refuses and names each kind of blocker:

```text
upgrade_blocked engine_containers,runs
```

| Blocker | What to do |
| --- | --- |
| `runs`, `executions`, `dispatch_outbox` | A run has not ended. Start the services, wait for it or cancel it |
| `exports` | An export has not ended. Wait for it or cancel it |
| `input_uploads` | An input upload or input deletion has not finished. Finish or delete the upload, or wait for the deletion |
| `output_deletions`, `output_sources`, `output_slots` | Run output is still being collected or deleted. Start the services and let it settle |
| `attempt_ownership`, names starting `journal_` | The agent still holds work. Start the services and let it settle |
| `engine_containers`, `agent_container` | A container is still running. Stop the services and wait for engine containers to exit |
| `docker_daemon` | This is not the Docker daemon the installation was set up on |

A refusal with `conflict` means a service still holds the installation: stop it
and run the command again. `recovery_required` means something other than the
images differs from what the installation expects; the upgrade will not guess.

## Upgrade a source install

From the checkout, with the same `BEETLE_HOME` and other variables you always use:

```sh
docker compose down
git pull                                  # or check out the release you want
docker compose build
docker compose run --rm setup upgrade     # prepare
docker compose up -d                      # start the new version, fenced
# check the new version in the browser
docker compose down
docker compose run --rm setup upgrade activate
docker compose up -d
```

Each `setup upgrade` command prints one JSON line when it succeeds, for example
`{"installationId":"…","operationId":"…","status":"awaiting_activation",…}`,
and exits 0. On failure it prints the code on standard error and exits 1. One
command may take up to 30 minutes.

## What prepare does

`docker compose run --rm setup upgrade` (or `setup upgrade prepare`) runs these
steps, recording each one before moving on:

1. **Receipt.** Writes `upgrade/receipt.json` with the old and new image pins
   and schema versions, phase `backing_up`.
2. **Sealed backup.** Copies the whole installation, credentials included, and
   seals the copy with the SHA-256 of its manifest. Phase `applying`. Until this
   point nothing in the installation has changed.
3. **Fence.** Selects the new image pins and sets the upgrade fence in one
   atomic step (`configuration`).
4. **Profiles.** Approves the new engine profiles in the agent's journal
   (`journal`).
5. **Migration.** Migrates the metadata database (`metadata`).
6. **Awaiting activation.** The phase becomes `awaiting_activation`.

Running prepare again when it is already awaiting activation changes nothing.
If the images did not move, it reports `unchanged`.

## Check the new version

Start the services with `docker compose up -d`. The app serves the new version
behind the fence: you can look at everything, but it accepts no new work.

| While fenced | Allowed |
| --- | --- |
| Reading suites, runs, results, inputs, exports and settings | Yes |
| Signing in, cancelling runs and exports, comparing runs, retention and deletion previews | Yes |
| Starting runs or exports, saving suites, uploads, settings, pins, notes, deleting | Refused |
| Changing capacity with the host command | Refused with `upgrade_blocked` |

A refused action currently shows as `503 capacity_unavailable`, the same retryable
error as a full installation. There is no dedicated upgrade error code yet.

When you are satisfied, stop the services and activate.

## Activate

`docker compose run --rm setup upgrade activate` checks that the selected
configuration matches the images on the host, removes the fence and records
`activated`. Start the services again and new work is accepted. Running it again
changes nothing. If the images moved again since prepare, it refuses with
`recovery_required`; roll back instead.

## Roll back

Before activation only, `docker compose run --rm setup upgrade rollback` puts the
installation back exactly as it was. With the services stopped, it verifies the
backup's seal and the installation's identity, rebuilds the installation beside
the current one, compares it entry by entry with the manifest, then swaps it in.
After activation, rollback is refused with `upgrade_blocked activated`.

Rollback restores the data and the old image pins, not the old images. Startup
with the new images reports `upgrade_required` again until the images the
installation is pinned to are back. `status` lists the pinned image IDs under
`from`.

## Interrupted or refused

Run the same command again. Every step is recorded and safe to repeat:

- Interrupted before the fence was set: nothing in the installation has
  changed, and prepare takes a fresh backup.
- Interrupted after: prepare continues from the next unfinished step.
- Interrupted during rollback: rollback completes the swap it had started.
- `upgrade_blocked images_moved`: the images were rebuilt while an upgrade was
  open. Roll back, then prepare again.

`docker compose run --rm setup upgrade status` prints the current phase and the
steps done, without changing anything. `"status":"none"` means no upgrade is open.

## Where backups live

Everything sits in `upgrade/` inside `BEETLE_HOME`, next to the installation:
`receipt.json` for the open operation, and one directory per operation holding
its backup and finished receipt. After a rollback, the replaced installation is
kept there too, under `replaced`.

The backup is private (owner-only) and contains the agent token and every other
credential of the installation. Protect it like the installation itself. It is
never removed for you: delete an operation's directory when you no longer need
it, and never while that operation is awaiting activation.

The archive from [Back up and restore history](/guides/backup-and-restore/) is
separate and still the way to keep long-term backups.
