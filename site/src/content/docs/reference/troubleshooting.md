---
title: Troubleshooting
description: What to do when a run waits, errors, ends inconclusive, an automation call reports an unknown outcome, or setup stops with an upgrade code.
sidebar:
  order: 2
---

## A run stays queued

The agent admits a run only when its whole budget fits. The run page shows the
current reason. Common ones:

- **Not enough capacity.** Another run, or an export job, holds the CPU, memory,
  processes or output space. Runs keep their reservation until their output is
  settled, so a finishing run can still block a new one for a moment.
- **Waiting for isolation.** An isolated run starts only when nothing else is
  running. Choose the parallel policy if isolation does not matter for this test.
- **The machine is too small for the budget you want.** Budgets must fit your
  settings and the installed pool; to allow larger runs,
  [change capacity](/guides/change-capacity/).

If starting a run is refused outright, the queue limit was reached. Wait for
queued work to finish.

## A run errored with `invalid_config`

Saving checks only the structure of a suite. The engine validates the full
configuration when it admits the run. Open the run's diagnostics for the reason,
fix the suite, which creates a new revision, and start a new run.

## A run ended inconclusive

The evidence could not decide pass or fail. Typical causes:

- A `ramp-until` scenario reached its maximum load without its stop rule firing.
  Raise the maximum or tighten the rule.
- Part of the result or metrics is missing. Check the warnings and diagnostics.

An inconclusive run is not a failure of your service; it is a test that needs
changing.

## Numbers look wrong

- Check the warnings first. Insufficient VUs or high metric cardinality can
  distort a measurement without failing any rule.
- If the run was parallel, other runs may have competed for the machine. Repeat
  it with the isolated policy.
- A value shown as unknown was not collected. It is never zero.

## Cancel did not stop the run at once

Cancel is recorded immediately, then the engine is asked to stop and given 5 s
before it is forced. The run turns `cancelled` only after the engine exits and its
output is safe. If the run was already finishing, it ends with its real outcome.

## The automation client says `outcome_unknown`

The reply to a `run` or `cancel` was lost, so the client cannot tell whether the
change happened. Run the same request file again, with the same `requestId`. The
server returns the original receipt instead of acting twice. A new ID could start
a second run. See [Automate from CI](/guides/automation/).

## The UI says read-only

You are looking at a restored history viewer. It can show runs and results but
cannot start runs or change anything. See
[Back up and restore history](/guides/backup-and-restore/).

## Actions are refused after an upgrade

If the app shows everything but refuses to start runs, save suites or change
settings with `503 upgrade_pending`, an upgrade is awaiting activation. Check it with
`docker compose run --rm setup upgrade status`. The fence refuses new
work until you [activate or roll back](/guides/upgrade/#check-the-new-version).

## Setup stops with a code

The `setup` container prints one code on standard error and exits 1. Read it
with `docker compose logs setup`.

| Code | Meaning | What to do |
| --- | --- | --- |
| `upgrade_required` | The images moved since the installation was set up, for example after `docker compose up --build` on a newer checkout | [Upgrade the installation](/guides/upgrade/), or start it with the images it was set up with |
| `upgrade_blocked ITEMS` | An upgrade command refused; each item names a reason | See below |
| `conflict` | A running service still holds the installation | Stop the services with `docker compose down` and run the command again |
| `binding_changed ITEMS` | The instance name, installation folder or Docker socket differs from the ones the installation was set up with; items name each one (`agent_container`, `target_network`, `root`, `docker_socket`, `agent_origin`) | Start it with its original `BEETLE_INSTANCE` and `BEETLE_HOME`. Renaming an installation is not supported; set up a new one in another folder instead |
| `binding_changed external_origin` | `BEETLE_ORIGIN`, or `--from` of `setup origin`, differs from the address the installation serves | Start it with the address it serves (unset `BEETLE_ORIGIN` for the default), or [change the address](/guides/private-network/#change-the-address-of-an-existing-installation) |
| `origin_blocked ITEMS` | `setup origin` refused; each item names a reason | See below |
| `network_access_required` | `BEETLE_ORIGIN` or `BEETLE_BIND` is not a loopback address, but `BEETLE_ACCESS` is not `network` | Set `BEETLE_ACCESS=network` only if one person uses it over a private network; see [Open it over a private network](/guides/private-network/) |
| `invalid_input` | A setting is malformed, for example an `http://` origin on another host, a trailing slash, or a `BEETLE_BIND` that is not an IPv4 address | Use one `https://` origin with no path, and an IPv4 bind address |
| `recovery_required` | Something other than the images differs from what the installation expects, or an upgrade found state it cannot trust | Keep the installation directory and any upgrade backup exactly as they are |

`upgrade_blocked` items:

| Item | What to do |
| --- | --- |
| `runs`, `exports` and other work names | Something is still in progress; see [the blocker table](/guides/upgrade/#before-you-start) |
| `engine_containers`, `agent_container` | Stop the services and wait for engine containers to exit |
| `not_awaiting_activation` | `activate` needs a finished prepare; run prepare first |
| `no_pending_upgrade` | There is no upgrade to roll back |
| `activated` | The upgrade was activated; rollback is no longer possible |
| `rollback_pending` | A rollback was interrupted; run `rollback` again to finish it |
| `images_moved` | The images were rebuilt while an upgrade was open; roll back, then prepare again |
| `origin_change` | An address change was interrupted; run `setup origin` again with its operation ID to finish it |

`origin_blocked` items:

| Item | What to do |
| --- | --- |
| `engine_containers`, `agent_container` | Stop the services and wait for engine containers to exit |
| `upgrade` | Activate or roll back the open upgrade first |
| `capacity_change` | Run the interrupted resource change again with its operation ID to finish it |
| `origin_change_pending` | Run the interrupted `setup origin` again with its operation ID to finish it |
| `origin_history_full` | The installation has recorded 256 address changes; set up a new one in another folder |

`setup origin` reusing an operation ID with other addresses stops with `conflict`.

Do not delete `.beetle/` or its `upgrade/` or `origin/` directories to get past one of these
codes. They hold your data and, during an upgrade, the only way back.
