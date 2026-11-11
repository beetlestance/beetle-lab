# Explicit rewrite Compose installation

Status: composition locally verified, separate from released legacy Compose.
See [evidence](../../verification/compose-installation.md) for actual corrections/limits.
Depends on [starter](installation-starter.md), [provisioning](fresh-installation.md),
[installer image](installer-image.md) and [service images](container-recipes.md).

## Topology and effects

compose.rewrite.yml is opt-in. Frontend, backend and agent are separate services.
Only frontend publishes127.0.0.1:configured-port. Frontend also joins an ingress bridge for published-port reachability.
Control network is internal;
backend/agent have no published ports. Engine attempts use a separate target-egress
bridge created during explicit installer setup, never the control network.
No database/object-store/external IAM is introduced in the local first release.

Installer uses a setup profile, executes once explicitly and exits. It is not a
startup dependency: replaying installation while serving would conflict with its
offline authority gate. A separate images profile lets Compose build/tag the k6
engine without starting a load job. Normal up excludes both profiles.

Source builds use the existing five pinned component recipes. Image references
are explicit environment settings so a later pull install can use matched immutable
published identities; this task does not publish them or claim registry availability.
No latest legacy image is replaced. Starter CLI bundling follows its accepted
component before the first complete setup check.

## Paths, identity and resources

Required environment fields: BEETLE_INSTANCE, BEETLE_ROOT, BEETLE_REQUEST_FILE,
BEETLE_UID, BEETLE_GID, BEETLE_DOCKER_GID, BEETLE_DOCKER_SOCKET, BEETLE_PORT,
BEETLE_FRONTEND_IMAGE, BEETLE_BACKEND_IMAGE, BEETLE_AGENT_IMAGE,
BEETLE_INSTALLER_IMAGE, BEETLE_ENGINE_IMAGE. No credential environment field.
Generated request must use dockerSocket /var/run/docker.sock (container path),
agentOrigin http://agent:4312, agentContainer beetle-INSTANCE-agent, targetNetwork
beetle-INSTANCE-targets, externalOrigin http://127.0.0.1:PORT and exactly the same
root/uid/gid/image references. BEETLE_DOCKER_SOCKET is the host source path.
The installer build includes the accepted starter CLI as /beetle/install/starter.js;
run it explicitly with --entrypoint node and private --options file before setup.
Root/request/socket paths are explicit absolute host paths; bind mounts do not
silently create missing host files/directories. Installation root remains at the
same absolute path inside installer/backend/agent, so daemon-resolved engine bind
sources agree with agent staging paths. No named-volume translation for staging.

Installer mounts private request/root and Docker socket. Agent mounts only config
read-only, journal and staging as distinct exact read-write binds, published inputs
read-only and Docker socket. Staging uses explicit rprivate propagation: the existing
agent attestation requires an exact staging-root mount and rejects ancestor mounts.
Backend mounts config read-only/backend state read-write. Frontend mounts neither.
Shared positive uid/gid owns private files; only installer/agent get the explicit
socket supplemental group. Socket read-only mount still grants powerful daemon
access; this is a trusted local installation boundary, not a hostile multiuser host.
No automatic recursive chown/repair or deletion of existing state.

All service rootfs read-only; cap_drop ALL; no-new-privileges; finite /tmp/PID/CPU/
memory/log limits; graceful stop bounds. Backend/agent each CPU0.25,memory256MiB,
PID64; frontend CPU0.1,memory64MiB,PID32. These hard caps sum to starter control
reserve CPU600/memory576MiB/PID160. They are not measured stack overhead claims.
Installer is offline, bounded CPU1,memory256MiB,PID64. Native engine limits remain
owned by admission/profile and per-attempt Docker spec, not Compose engine service.
No automatic process backend fallback or sensor availability claim.

## Checks and remaining work

Validate resolved Compose configuration with synthetic environment and no credential
reads; verify only frontend publishes, profiles stay excluded from normal up,
actual resource/mount/path declarations and exact fixed startup names.
Then run one task-owned empty-root setup: build only missing/changed images, generate
private request from explicit options, actual provisioner/Docker/Journal, start
services, pair through frontend, do one real synthetic k6 run, stop/reopen and inspect
results. Preserve failed/interrupted roots and original evidence; do not hide setup
failures or reset shared data to obtain success. Only recorded owned containers/
networks/temp data may be cleaned. No global prune/push/deploy.
Native amd64, published pull installation, browser, scans, measured overhead and
full feature/recovery qualification remain distinct release checks.

## First-use launcher

The next first-use packet adds deploy/local/beetle (POSIX shell) and a packaged
local setup CLI. Commands up/stop/status/token accept --directory; up also accepts
--port, --socket, --docker-gid and --build. No host Node/npm dependency. Source-build
mode requires a Git checkout; derive a safe revision tag and rebuild dirty/missing
images rather than reusing stale source. Use an explicit optional BEETLE_BUILDER
without changing Docker context/default builder; build services serially.

CLI tools/install/local-cli.ts exports runLocalSetupCli(argv) and accepts exact
pairs --directory ABS --uid N --gid N --docker-gid N --docker-socket ABS --port N
--revision TAG, with optional --instance NAME. It creates private directory/setup
and directory/data, setup/options.json, request.json and compose.env using existing
starter/capture semantics. Default instance is a stable hash of the canonical
directory. All caller-owned paths/IDs/URLs/images are derived once consistently.
No credentials or installation authority are created by this configuration step.
New files0600/directories0700, current positive owner, canonical/no-follow identities,
exclusive creation; no overwrite/chown/recursive repair/delete on failures. Existing
complete matching configuration returns unchanged; partial/conflicting state fails
explicitly and remains preserved. Never ignore native close/rename/sync errors.

The launcher resolves the actual local Unix socket (remote daemons unsupported in
this local profile), probes its container-visible group with a bounded finite image,
and prepares config through the packaged CLI as the common non-root owner. Compose
uses --env-file, never shell-evals generated config. Preserve spaces safely; reject
unsupported delimiter/control paths explicitly. Do not read an unrelated repo .env.

up builds missing/explicitly requested source images, provisions only a fresh root,
and starts the three services. Existing ready installation skips offline provisioning
while serving. Do not rewrite settings/credentials or silently migrate image pins.
Print the loopback URL and how to obtain the latest startup token; token is the only
explicit command that prints that local bootstrap credential. stop preserves data;
status is read-only. No global prune, published tags or legacy-default replacement.
Worker owns local CLI/helpers, launcher, focused tests and deploy/local README;
coordinator owns build entry/recipes, integration and actual Docker/browser proof.
