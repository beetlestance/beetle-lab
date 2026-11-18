---
title: Retention and deleting
description: Which retention settings exist, what deleting removes, and why space returns only after the backend and the agent both confirm.
sidebar:
  order: 6
---

Run results and files stay until you delete them. You can delete one run at a
time, or set a **retention policy** that selects old runs for you. Either way,
nothing is deleted until you review the list and apply it.

## Retention policy

A retention policy is either `manual` or `enabled`.

| Mode | Effect |
| --- | --- |
| `manual` | Selects nothing. This is the default. |
| `enabled` | Selects runs by one or more of the rules below |

| Rule | Field | Selects |
| --- | --- | --- |
| Age | `ageDays`, 1 to 365,000 | Runs requested more than this many days ago |
| Count | `completedRunCount` | Completed runs beyond this many of the newest |
| Storage | `storageBytes` | Completed runs beyond the newest ones that fit in this many bytes |

An enabled policy needs at least one rule. When it has several, a run that any
rule selects is a candidate. Retention works per workspace, newest run first.

The policy is set at installation, organisation or workspace level and inherited
like other settings; see [Organisations and workspaces](/concepts/workspaces/). It
is one setting, so a workspace override replaces the whole policy, not single
rules.

## Preview, then apply

Retention never runs on its own. In a workspace's settings:

1. **Preview.** Beetle Lab captures a page of up to 100 candidate runs, each with
   its estimated size and the rule that selected it. It also lists how many runs
   it left out, and why.
2. **Apply.** You confirm that exact page with **Remove** and the number of runs.
   Only the runs shown are deleted, or **Discard preview** to drop it.

A preview expires after 15 minutes. An expired preview cannot be applied; take a
new one. If anything that affects the selection changed since the preview, such
as a pin or a settings change, Apply refuses the whole page and deletes nothing.

At organisation and installation level, the preview walks through the workspaces
one at a time and links to each. Applying always happens in a workspace.

## What is never selected

| Left out | Why |
| --- | --- |
| Active runs | Only completed runs (`finished`, `cancelled` or `errored`) can be deleted |
| Pinned runs | You asked to keep them; see [Pinning runs](#pinning-runs) |
| Runs already being cleaned up | Their deletion is already under way |
| Runs whose size cannot be confirmed | Shown as unknown rather than guessed |

Completed runs that are left out still count towards the count and storage rules.
They are kept, but they use part of the allowance. The preview lists them under
**Never removed by this preview**, grouped by reason with their estimated size.

## Pinning runs

A **pin** keeps one completed run out of retention and out of manual deletion
until you unpin it. It is a protection, not a copy: the run stays where it is and
still uses its space.

- Open a finished run and choose **Pin this run**. The button shows **Pinned**
  once the server confirms; nothing is shown as pinned before that, because
  deleting depends on it. Press it again to unpin.
- Only completed runs can be pinned. A queued, active or finalizing run has no
  pin control, and a run whose deletion has started cannot be pinned.
- A workspace holds at most 256 pinned runs. The 257th pin is refused; unpin one
  first. The **Pinned** filter in the **Runs** tab lists them, and a **Pinned**
  badge marks them in the list.
- A pinned run still counts towards the count and storage rules. If pinned runs
  alone use more than a storage or count limit, no preview can meet that limit;
  the preview does not warn about this yet, so unpin runs or raise the limit.
- Pinning or unpinning while a preview is open makes that preview stale. Apply
  then refuses the whole page and removes nothing; take a fresh preview. Apply
  checks every pin again itself, so a pinned run is never removed.
- Deleting a pinned run by hand is refused. The delete dialog offers to unpin it
  first.
- A retired workspace keeps its pins with its runs. Restored history shows each
  run's pin state from the backup, read-only.

## Deleting one run

From a completed run's page, choose **Delete run…** to delete just that run. The
dialog previews the deletion, with what it would free and when it was checked,
and deletes only when you confirm. It uses the same preview and apply steps and
the same checks. A pinned run must be unpinned first.

## What deleting removes

Deleting a run removes its result and the rest of its artefacts from disk, then
returns their space to the installation. The work happens in steps, and the
status shows which one each run has reached:

| Phase | Meaning |
| --- | --- |
| `admitted` | Accepted for deletion; nothing removed yet |
| `backend_files` | The backend is removing its copy of the files |
| `agent_cleanup` | The agent is removing its own copy and confirming it is gone |
| `settling` | Both sides have confirmed; the space is being returned |
| `settled` | Done; the space is available again |
| `blocked` | Cleanup could not continue; the status gives a reason |

Space returns only after **both** the backend and the agent have confirmed that
the files are gone. A failed or interrupted deletion therefore never frees space
that is still used on disk. Estimated sizes in a preview are not freed space.

:::note
When a run is queued, and again when the agent admits it, a small amount of
storage is set aside in Beetle Lab's own accounting for deleting it later, so run
outputs that fill the storage pool cannot block a deletion. This is bookkeeping, not space held on the disk: Beetle Lab
does not preallocate disk or database space for it, and a host disk that is
really full can still stop a deletion from finishing. Keep free disk space on the
host.
:::

## When storage is full

Running out of output space stops new runs from being admitted. It never
deletes anything by itself. Free space by deleting runs or applying retention, or
add space; see [Change capacity](/guides/change-capacity/).

## Things that are kept

- **Workspaces.** Deleting a workspace only hides it. Its runs and files stay and
  keep their space. Delete its runs first if you need the space back.
- **Inputs in use.** An input that a suite revision uses is pinned and cannot be
  deleted until no revision needs it.
- **Suite revisions.** Revisions are immutable and are not removed by retention.

See [Runs](/concepts/runs/) for how deleting relates to a run's lifecycle.
