---
title: Reconcile task folders
description: Let cleanup finish for runs whose task folders were renumbered by a Docker restart, with the offline reconcile command.
sidebar:
  order: 10
---

Each run gets a task folder under the agent's staging root. The agent records the
folder's device and inode numbers so that cleanup only ever removes the folder it
created. Some Docker setups, Docker Desktop among them, give folders new numbers
when Docker restarts. New runs are not affected, but a run whose folder was
prepared before the restart can no longer be cleaned: cleanup refuses it and the
run's storage is never released.

The offline `reconcile` command records the folder's current numbers for those
runs, after proving that the run's container is gone and that the folder still
has the same owner, group and permissions. It never deletes anything; the normal
cleanup does that afterwards, against the newly recorded numbers.

The examples use the default instance name `lab`, so the agent container is
`beetle-lab-agent`. If you set `BEETLE_INSTANCE`, use `beetle-<instance>-agent`.

## 1. Stop and remove the agent container

```sh
docker compose stop agent
docker compose rm -f agent
```

The command runs in a one-off container that must use the agent's own container
name, so the stopped container has to be removed first. Your data lives in the
installation folder and is not touched. The backend can keep running; it reports
the agent as unavailable until you start it again.

## 2. Preview

```sh
docker compose run --rm --no-deps --name beetle-lab-agent agent reconcile
```

The listing itself only reads the journal, but the command first starts up the
same way the agent does: it can upgrade the journal to the current version and
it clears the agent's last resource reading, which the agent takes again when it
next starts. It prints one JSON line per run that has a retirement in progress,
a prepared task folder and no cleanup plan yet, then a summary:

```text
{"attemptId":"…","reconciled":false}
{"mode":"preview","attempts":1,"refused":0,"stopped":false}
```

`reconciled: true` means numbers were already recorded on an earlier run of the
command; such runs stay listed until cleanup finishes them. An empty list means
there is nothing to do.

## 3. Apply

```sh
docker compose run --rm --no-deps --name beetle-lab-agent agent reconcile --apply
```

For each listed run, one at a time, the command retires the run's producer again,
proves its container is absent, reads the folder and records its numbers:

| Outcome | Meaning |
| --- | --- |
| `reconciled` | New numbers were recorded. |
| `current` | The folder already matches what cleanup checks against. |
| `refused` | Nothing was recorded; `reason` says why. |

A run is refused, and its folder left in place, when a container with its name
exists again, when the folder's owner, group or permissions changed, when it
holds links or special files, or when a cleanup plan was stored before the
restart. Those runs need manual inspection.

## 4. Start the agent

```sh
docker compose up -d agent
```

Cleanup then finishes for the reconciled runs the next time the backend asks for
it.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every listed run was `current` or `reconciled`, or nothing was listed. |
| `1` | At least one run was refused, the command was stopped, or it could not start. |
| `2` | Unknown arguments; only `reconcile` and `reconcile --apply` are accepted. |

Pressing Ctrl-C (or sending SIGTERM) cancels the run being reconciled, starts no
further run and closes cleanly; the summary then shows `"stopped":true`. A stop
while the command is still starting shows the same summary with `"attempts":0`.
Runs already reconciled keep their recorded numbers.

The command refuses to start while the agent is running, because both take the
same exclusive lock on the installation. It never listens for requests and never
starts new runs.
