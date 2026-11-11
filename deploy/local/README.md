# Opt-in local rewrite installation

This development path uses separate frontend, backend, agent and engine images.
The released root Compose file remains unchanged. Full rewrite/release qualification
is pending; this path has local native arm64 first-boot evidence only.
Docker Compose is required; no host Node/npm installation is needed.

## Prepare private deployment files

Use a private setup directory outside the repository and a separate empty data
root, both owned by the same positive UID/GID and mode0700. Keep their canonical
absolute host paths unchanged inside containers. Do not use symlink paths. Use a
persistent data directory, rather than a temporary directory under container /tmp.
Existing or interrupted installations must be preserved; setup does not repair them.

Create private mode0600 compose.env and options.json from the examples here.
Edit the examples before using them. Do not place private files in the repository.
Use `id -u` / `id -g` for the common non-root installation owner. On Linux, set the
socket group to the group that can open the Docker socket inside the containers.
Docker Desktop commonly needs supplemental group0; this does not change primary UID.
Set BEETLE_DOCKER_SOCKET to the actual host socket (for example
$HOME/.docker/run/docker.sock on Docker Desktop). In options.json, dockerSocket
stays /var/run/docker.sock, its container destination.

The two files must agree on root, UID/GID, image references and frontend port.
For instance NAME, use agentContainer beetle-NAME-agent and targetNetwork
beetle-NAME-targets. Keep agentOrigin http://agent:4312 and externalOrigin
http://127.0.0.1:PORT. Each installation needs a unique name, data root and port.
The examples use explicit starter image tags for local builds, not published images.

## Build and initialize

From the repository root, load only your own edited environment file. Its values
must also be valid shell assignments; quote paths containing spaces.

```sh
set -a
. /absolute/private/setup/compose.env
set +a

dc() { docker compose -f compose.rewrite.yml "$@"; }
dc --profile setup --profile images build frontend backend agent installer engine-image
```

Generate the explicit request with the packaged starter. Replace the options path
below with your actual private file. The shell's noclobber mode preserves an
existing request; generate it once, and stop if this command fails.

```sh
(
  umask 077
  set -C
  docker run --rm --network none --read-only \
    --user "$BEETLE_UID:$BEETLE_GID" \
    --cpus 1 --memory 256m --pids-limit 64 \
    --mount type=bind,source=/absolute/private/setup/options.json,target=/options.json,readonly \
    --entrypoint node "$BEETLE_INSTALLER_IMAGE" \
    /beetle/install/starter.js --options /options.json > "$BEETLE_REQUEST_FILE"
)
```

Review/edit the private request before initialization if you want different initial
budgets or retention. Defaults allow a2CPU/1GiB execution pool, up to2 attempts,
and manual retention. These are policy ceilings, not detected available capacity.
The control services reserve separate resources. Initial policy details are in
[the starter contract](../../docs/design/lld/installation-starter.md).

```sh
dc --profile setup run --rm --no-deps installer
dc up -d --no-build --pull never frontend backend agent
dc logs backend
```

Open http://127.0.0.1:PORT and pair with the latest startup token from backend logs.
Keep these logs private. The API can become reachable before execution capacity
is ready; a refused capacity request starts no workload. Only frontend publishes
a host port. Never expose the agent or Docker socket to the browser/network.

## Stop, restart and preserve data

```sh
dc stop
dc up -d --no-build --pull never frontend backend agent
```

Use a new pairing token after backend restart. Do not run the offline installer
while services are running. Its ready-state replay verifies identities and the
Journal gate; it does not rotate credentials or replace existing settings.
A failed/interrupted initialization is preserved and requires explicit recovery.

`dc down` removes Compose containers/networks; bind-mounted data remains. Do not
remove installation state or engine containers to fix a stuck/unknown attempt:
unknown execution stays charged until reconciled. Fresh unrelated installations
use new private roots. Existing settings can be changed through the UI; agent
admission-policy changes remain a separate installed-runtime operation.

Published image-pull installs, native amd64, browser and resource/security release
checks remain pending. See [component evidence](../../docs/verification/container-recipes.md).
