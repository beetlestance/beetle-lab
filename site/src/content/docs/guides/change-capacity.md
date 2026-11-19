---
title: Change capacity
description: Raise the per-run memory or grow the output pool of an existing installation without losing history.
sidebar:
  order: 3
---

This maintenance operation changes the installation's default run memory or its
total output pool. It keeps history, credentials, retention and every other
setting, including organisation and workspace overrides.

:::caution[Stop work first]
Stop the backend and the agent before you begin. The operation refuses while any
run is active, queued or unfinished. Do not delete that work to force it through.
:::

## Default Compose installation

Build the reviewed source images, generate one operation ID with `uuidgen`, keep it
with the result, and run:

```sh
docker compose stop backend agent
docker compose run --rm --no-deps --entrypoint node setup \
  /beetle/install/compose-capacity.js --memory-mib 1024 \
  --operation-id YOUR_OPERATION_UUID
docker compose up -d --no-build backend agent
```

Use the same Compose environment, home directory and images as the original
setup. If the operation is interrupted, repeat the identical command with the
same ID. Until it completes, the installation stays fenced rather than half
changed. An [address change](/guides/private-network/#change-the-address-of-an-existing-installation)
is refused meanwhile with `origin_blocked capacity_change`; a capacity change keeps
an address changed earlier.

## Grow the output pool

To give runs more total output space, use `--output-pool-mib 512` instead of
`--memory-mib 1024`, with a new operation ID. Choose exactly one of the two flags
per operation.

Growing the pool keeps per-run budgets, memory, history and existing reservations.
It uses the storage already allocated and its free-space reserve; it does not add
disk to the host or turn on retention.

## Advanced installations

An installation provisioned from a request file uses that original request:

```sh
node /beetle/install/capacity.js \
  --request /private/setup/request.json \
  --agent-worker /beetle/install/agent-worker.js \
  --backend-worker /beetle/install/backend-worker.js \
  --memory-mib 1024 --operation-id YOUR_OPERATION_UUID
```

- Run it as the installation's user and group, with the original mounted paths.
- Outside the installer container, `--docker-socket /absolute/path` selects the
  same verified Docker daemon.
- Do not edit the original request or its receipts.
- An agent that reads an external operator configuration is refused; reconcile it
  first.

## What it does not change

The installed pool is fixed: a 1 GiB pool admits at most one 1 GiB run at a time.
This operation does not enlarge the pool, the host VM, the control containers or
their reserves. Workspace overrides stay in force, so choose a 1 GiB run budget in
any workspace that overrides the default.

Success means the new configuration is committed. After the restart, check that
the agent is ready: it installs the new policy and takes fresh measurements before
admitting runs.
