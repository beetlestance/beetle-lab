---
title: Install
description: Start Beetle Lab with Docker Compose on your computer or a server, open the UI and keep your data between restarts.
sidebar:
  order: 1
---

Beetle Lab runs as a set of Linux containers. You need Docker with Docker Compose
on amd64 or arm64. No host Node.js is needed to run it.

## Start it

From a checkout of the repository:

```sh
docker compose up --build -d
```

Open <http://127.0.0.1:4567>. The browser signs you in automatically as the
administrator; there is no password or startup token in the default setup.

The first start builds the images and prepares a private installation under
`.beetle/` in the checkout. Keep that directory: it holds your configuration,
suites, inputs and results. To use another location, set `BEETLE_HOME` to an
absolute path **before the first start**.

Stop the installation with:

```sh
docker compose down
```

Stopping keeps every container's data. Starting again reuses the same images,
identity and data.

After you update the checkout and rebuild, startup stops with `upgrade_required`
instead of moving your data to the new images on its own. Follow
[Upgrade an installation](/guides/upgrade/) to back up, migrate and activate.

:::tip[Testing a service on your own computer]
Containers cannot reach `localhost` on your machine. On Docker Desktop, point
targets at `http://host.docker.internal:PORT` instead.
:::

## Run it on a server

Run the same command on the server, then forward the UI port from your computer:

```sh
ssh -N -L 4567:127.0.0.1:4567 user@your-server
```

Open <http://127.0.0.1:4567> locally. Tests and engines run on the server; only the
browser runs on your computer. The UI only accepts loopback addresses today, so
opening the server's IP or a domain directly, or putting a public reverse proxy
in front, is not supported yet.

## Launcher for a separate directory

The repository also ships a launcher that keeps an installation in a directory
of your choice, with explicit status and stop commands:

```sh
./deploy/local/beetle up --directory "$HOME/.beetle-lab"
./deploy/local/beetle status --directory "$HOME/.beetle-lab"
./deploy/local/beetle stop --directory "$HOME/.beetle-lab"
```

The directory's parent must exist, and the path must be absolute with no symbolic
links. Use `--port` to choose another UI port and `--socket` for a non-default
Docker socket, for example `$HOME/.docker/run/docker.sock` on Docker Desktop.

## What gets installed

| Container | Role | Reachable from |
| --- | --- | --- |
| Frontend | Serves the UI and forwards API calls | Your browser, on loopback only |
| Backend | API, metadata, results and reports | The frontend only |
| Agent | Admits runs and controls engine containers | The backend only |
| k6 engine | One disposable container per run | Your test targets only |

Default limits allow a 2 CPU, 1 GiB execution pool with manual retention. You can
lower run budgets in settings; raising the installed ceilings is a separate
[capacity change](/guides/change-capacity/).

## Before you rely on it

- Beetle Lab is a single-administrator tool. Anyone who can reach the UI can run
  tests and control engine containers.
- The agent has access to the Docker socket, which means control of the Docker
  host. Install it only where you trust the administrator and the test code. See
  [trust and security](/concepts/security/).
- Back up with the [backup and restore](/guides/backup-and-restore/) procedure,
  not by copying `.beetle/` while it runs.

Next: [run your first test](/start/first-test/).
