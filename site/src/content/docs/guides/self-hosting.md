---
title: Run it on a server
description: Install Beetle Lab on a VPS or server, reach the UI through an SSH tunnel, and keep its data across restarts.
sidebar:
  order: 7
---

Running on a server is the same installation as on your computer: Docker Compose
starts the containers, and tests run on the server. Only the browser runs on your
own machine, connected through an SSH tunnel. This page covers what differs on a
server; [Install](/start/install/) covers the basics.

## Requirements

| Need | Detail |
| --- | --- |
| Operating system | Linux on amd64 or arm64 |
| Docker | Docker Engine with Docker Compose, on a local Unix socket |
| Source | A Git checkout of the repository; images are built from it |
| User | A non-root account that can use Docker |
| Network | SSH access from your computer; the server must reach your test targets |

Remote Docker daemons over TCP or SSH are not supported. Run the commands on the
server itself.

The starter settings allow an execution pool of 2 CPUs and 1 GiB of memory, with
two runs at a time. The backend, agent and frontend are capped at 1.35 CPUs and
576 MiB together. These are defaults, not a measurement of your server.
[Change capacity](/guides/change-capacity/) explains what you can raise.

## Choose where the data lives

Pick a persistent absolute path for the installation before the first start,
for example `/srv/beetle`.

```sh
export BEETLE_HOME=/srv/beetle
```

Set these variables the same way for every Compose command on this installation.
Without `BEETLE_HOME`, Compose looks under `.beetle/` in the checkout instead.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BEETLE_HOME` | `.beetle` in the checkout | Installation directory |
| `BEETLE_PORT` | `4567` | UI port, published on the server's loopback only |
| `BEETLE_INSTANCE` | `lab` | Compose project name; use another for a second installation |

## Start it

From the checkout on the server:

```sh
docker compose up --build -d
```

The first start builds the images and prepares the installation. The backend,
agent and frontend restart unless you stopped them, so they come back after the
Docker service restarts.

## Open the UI through a tunnel

The UI listens on `127.0.0.1` on the server only. From your computer, forward the
same port number:

```sh
ssh -N -L 4567:127.0.0.1:4567 user@your-server
```

Then open <http://127.0.0.1:4567> on your computer. The browser signs you in
automatically as the administrator.

- Use the **same port** on both sides and the address `127.0.0.1`. The backend
  checks that the browser's address matches the configured one exactly, and
  refuses anything else.
- Opening the server's IP address or a domain name, or putting a public reverse
  proxy in front, is not supported. The UI accepts loopback addresses only.
- Anyone who can open the tunnel can use the UI, so limit who has SSH access.

## Or use the launcher

The launcher keeps an installation in a directory you choose, with explicit
status and stop commands. It is useful when you want the installation outside the
checkout or more than one installation on a server.

```sh
./deploy/local/beetle up --directory /srv/beetle-lab
./deploy/local/beetle status --directory /srv/beetle-lab
./deploy/local/beetle stop --directory /srv/beetle-lab
```

| Option | Applies to | Purpose |
| --- | --- | --- |
| `--directory` | all commands | Installation directory; default `$HOME/.beetle-lab` |
| `--port` | `up` | UI port; default `8080` for a new installation |
| `--socket` | `up` | Docker socket path, if not the active context's |
| `--docker-gid` | `up` | Docker socket group, instead of detecting it |
| `--build` | `up` | Rebuild the images |

- The directory's parent must exist. The path must be absolute and canonical,
  with no symbolic links, and must not contain commas, colons, quotes, `$`, `\`
  or `#`. Spaces are fine.
- Run it as your normal user. It refuses root, and it never changes ownership or
  permissions for you.
- `up` prints the address to open. Tunnel that port as shown above.
- Give each installation its own directory and its own port.

## Keep data across restarts

- `docker compose down` or the launcher's `stop` keeps all data. Starting again
  reuses the same images, identity, credentials, settings and history.
- Do not delete the installation directory, containers or engine containers to
  get past an error. Unfinished work stays recorded until it is settled, and a
  partial setup is left in place for you to inspect.
- Do not copy the directory while it is running. Take backups with the
  [backup and restore](/guides/backup-and-restore/) procedure.

## Upgrades

An installation is pinned to the images it was set up with. Starting it again
never moves it to newer images: after `docker compose up --build` on a newer
checkout, setup stops with `upgrade_required`. Move a Compose installation to the
new images with the offline upgrade command; see
[Upgrade an installation](/guides/upgrade/). Only the previous release can be
upgraded, and downgrading is not supported.

An installation keeps the settings and resource limits it was set up with. When
a newer release ships different defaults, only new installations get them. Its
instance name and folder are fixed too: starting it under another
`BEETLE_INSTANCE` stops setup with `binding_changed`.

With the launcher, a rebuild needs the same source revision the installation was
created from, and the upgrade command does not cover launcher installations.
After updating the checkout, set up a **new** directory with its own port for the
new version. To keep the old history, back it up and open it as read-only history;
see [Back up and restore history](/guides/backup-and-restore/).

## Security

The agent controls Docker on the server through its socket, which amounts to
control of the host. Beetle Lab has a single administrator and no user accounts.
Install it only on a server where you trust everyone with SSH access and the test
code they run. Read [Security](/concepts/security/) before you rely on it.
