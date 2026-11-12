# Local source installation

From a Git checkout, run the first-use launcher with Docker and Docker Compose:

```sh
./deploy/local/beetle up --directory "$HOME/.beetle-lab"
```

The launcher builds the five local component images serially, prepares private
configuration, initializes fresh installation authority once, and starts frontend,
backend and agent. No host Node/npm is required. Open the printed loopback URL.
The loopback UI opens automatically with a persistent HttpOnly session; no startup
token is needed. Session credentials stay in private installation metadata and the
browser cookie, with CSRF checked on writes. Restart preserves only the remaining
8h lifetime. Expiry renews automatically; sign-out stays signed out until reconnect.
Execution capacity can become ready after the frontend; refused capacity starts no
workload. This is one trusted local administrator, with no LAN/hosted access.

For an explicitly paired developer/CI profile, set BEETLE_LOCAL_ACCESS=paired in
the Compose environment. Only that profile emits a startup token and supports the
optional `beetle token` helper. Normal status/log/up output does not print tokens.

## Paths and local Docker access

`--directory` defaults to `$HOME/.beetle-lab`. Its parent must already exist. Use a
persistent, canonical absolute path with no symlink components, owned by your
current positive UID/GID. Existing deployment directories must be mode0700 and
files mode0600. The launcher never changes ownership or repairs permissions.
Spaces are supported. Commas, colons, quotes, dollar signs, backslashes, hash marks
and control characters in deployment/socket paths are rejected.

The local Unix socket is resolved from `DOCKER_HOST` or the active Docker context.
Remote TCP/SSH daemons are unsupported. Override the host socket explicitly when
needed, for example on Docker Desktop:

```sh
./deploy/local/beetle up --directory "$HOME/.beetle-lab" \
  --socket "$HOME/.docker/run/docker.sock" --port 8080
```

The launcher probes the socket's container-visible group using a finite, isolated
installer-image process. `--docker-gid N` supplies it explicitly; group0 is valid
as a supplemental socket group. Primary UID/GID must remain positive/current.
All Docker operations use the resolved local socket without changing your saved
Docker context or builder. A read-only Docker socket mount still grants powerful
daemon access: this profile assumes a trusted local user and Docker daemon.
No host credentials or Docker configuration directory are mounted into services.

## Private files and lifecycle

The directory contains `setup/options.json`, `setup/request.json`,
`setup/compose.env` and `data/`. Deployment files share the same instance name,
port, owner, paths and image tags. The default instance is a stable hash of the
canonical deployment directory. The data root keeps exactly the same absolute
host/container path for daemon-resolved staging mounts. Compose reads the explicit
environment file; the launcher never sources/evaluates it or reads a repository
`.env` file.

```sh
./deploy/local/beetle status --directory "$HOME/.beetle-lab"
./deploy/local/beetle stop --directory "$HOME/.beetle-lab"
./deploy/local/beetle up --directory "$HOME/.beetle-lab"
```

Stop preserves containers and all data. Up with a ready installation validates the
original deployment files, skips offline initialization and starts the same three
services. It does not rotate installation credentials, rewrite settings, reset
state or change image pins. Status performs read-only checks. Token reads only
bounded logs from the current backend start and fails if that token is unavailable.

Partial/interrupted configuration or initialization fails visibly and is left in
place for explicit recovery. Do not delete state or engine containers to work
around unknown attempts: unknown execution remains charged until reconciled.
Use a new directory for an unrelated installation, with a distinct frontend port.
The launcher does not perform automatic migration, reset, recursive chown or prune.

## Source image identity

Clean builds use the Git revision as a local tag. Dirty builds receive a distinct
`REV-dirty-TIME-PID` development tag and build every component; a previous dirty
build is never silently reused for fresh setup. These local tags are not published
immutable release identities.

For an existing deployment, available pinned images are reused. A missing image
or explicit `up --build` requires the original clean source revision; changed or
dirty source fails rather than rebuilding it under an older installation's tag.
Return to the matching checkout or use a new private deployment directory for
changed source. Existing dirty deployments can restart with their pinned images;
rebuilding their images requires a new directory. No automatic pin updates occur.

To select a preconfigured source-build builder explicitly:

```sh
BEETLE_BUILDER=my-builder ./deploy/local/beetle up --directory "$HOME/.beetle-lab"
```

This passes `--builder` only to source builds and never changes the default builder.
Only the frontend publishes a loopback port. Backend/agent remain private; do not
publish the agent or Docker socket. Starter defaults describe policy ceilings,
not detected machine capacity or measured stack overhead. Initial defaults allow
a2CPU/1GiB execution pool and manual retention; see
[starter policy](../../docs/design/lld/installation-starter.md).

This opt-in rewrite path is separate from released legacy Compose. Published image
installation, native amd64 and full security/resource/recovery qualification remain
separate checks. See [Compose evidence](../../docs/verification/compose-installation.md).
