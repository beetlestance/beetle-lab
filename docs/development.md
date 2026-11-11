# Rewrite development startup

The released app still uses `npm start`. The rewrite includes namespace/settings,
suite/input authoring, authenticated run control, agent execution, durable results,
event replay and sealed metric charts. Native backend/agent/k6 execution has local
evidence; complete Docker/Compose installation and release qualification remain pending.
Use Node24 and the locked development dependencies (`npm ci`).

## Create a private development installation

The explicit [fresh provisioner](design/lld/fresh-installation.md) creates coherent
private backend/agent configuration, token, Journal and authority gate. Supply an
owned private request file matching [ProvisionRequest](../tools/install/types.ts):
settings/policy/manifest are explicit, and the named images/network must already
exist. Provisioning performs read-only Docker inspection and creates no containers.
It never guesses host capacity or resets an interrupted/existing installation.

```sh
npm run build:api
npm run build:agent
node --import tsx tools/install/cli.ts \
  --request /absolute/private/provision.json \
  --agent-worker "$PWD/agent/dist/worker.js" \
  --backend-worker "$PWD/app/dist/worker.js"
```

This is an advanced source-development path, not a finished Compose installer.
Run as the request's non-root uid/gid. New directories use0700 and files0600.
An interrupted receipt requires explicit recovery; no automatic data reset exists.
Ready replay is offline and requires unchanged request/image pins and exclusive
authority. Subsequent serving startup retains its normal missing/restore fences.
Keep the installation identity and its private data across restarts.
The command prints configuration paths, never the generated token value.

## Start backend and frontend

```sh
npm run build:api
BEETLE_CONFIG_FILE="$PWD/.agent-output/dev/config/installation.json" \
BEETLE_AGENT_CONFIG_FILE="$PWD/.agent-output/dev/config/backend-agent.json" \
BEETLE_DATA_DIR="$PWD/.agent-output/dev/backend" \
BEETLE_EXTERNAL_ORIGIN=http://127.0.0.1:5173 npm run start:api
```

In another terminal run `npm run dev:web`, then open `http://127.0.0.1:5173`.
The development proxy preserves Host and forwards `/api/v2` to port 4311. Enter the
one-time token printed by backend startup. Tokens expire after 15 minutes or one use;
sessions last 8 hours. Logout/expiry requires restarting the backend to pair again.

Only a fresh, trusted agent observation can resolve effective resource settings.
An unreachable agent, mismatched profile or expired source leaves capacity unavailable.
The backend samples its own storage independently and retains original source expiry.

Backend defaults to loopback port 4311. `BEETLE_LISTEN_PORT` selects 1–65535;
`BEETLE_LISTEN_HOST=0.0.0.0` is reserved for the private backend container network.
The externally visible origin must remain canonical loopback in this release.
The data directory must exist, belong to the backend user and have mode 0700.
Config must be regular, single-linked, 32 KiB or smaller and not group/other writable.
Startup creates private `inputs/staging` and `inputs/published` children. Existing
unsafe roots are rejected. Pending publication/deletion is recovered in bounded
background pages; ordinary published inputs are not periodically rehashed.
The workspace Inputs view supports one local file up to8MiB, explicit recovery
after interruption, and verified download from selected current published status.
Upload drafts remain in memory and retire on workspace/session departure; partial
backend inputs can remain for explicit inspection/deletion.

## Check the built entrypoint

After building, `npm run smoke:api` starts an owned backend on a temporary loopback
port with disposable synthetic storage. It checks pairing, namespace access, full-size
suite revision save/read/replay, private config plus an explicit unavailable agent
HTTP fixture, metadata edits, a two-chunk input upload,
publication, terminated chunked download, deletion, logout
and SIGTERM cleanup; it never starts k6 or contacts a target. It requires permission
to bind that loopback port. CI runs build and smoke after the main verification gate.
`npm run smoke:input-controls` additionally drives the real frontend session and
upload controller through lost create/chunk/seal acknowledgements, exact replay,
committed-offset resume and verified empty/nonempty downloads. It uses the same
compiled backend and its own disposable installation.
These checks do not qualify browser cookies, container controls or either Linux architecture.

## Real Docker agent qualification

After building the agent and k6 recipes locally, run the isolated qualification:

```sh
docker build -f agent/Dockerfile -t beetle-lab-agent:local .
docker build -f engines/k6/Dockerfile -t beetle-lab-k6:local .
npm run smoke:agent:docker -- beetle-lab-agent:local beetle-lab-k6:local 200 default
npm run smoke:agent:docker -- beetle-lab-agent:local beetle-lab-k6:local 500 default
```

Use `desktop-linux` instead of `default` when that is the local Docker Desktop
context. The context must use a Unix endpoint; image/daemon architectures must match
amd64 or arm64. This exercise expects the daemon socket at `/var/run/docker.sock`
on its Linux host/VM and permission to create/remove its own containers/network.
It is a developer qualification command, separate from normal product installation.

The command uses fresh private temporary files, an internal HTTP target, bounded
containers and the real installed agent path. It checks pass/fail, seals, artifacts,
durable reservation release, clean agent exit and owned-resource removal. Exit0
means the qualification passed, including the expected failed-test outcome for500.
It prints the private evidence directory and retains it for inspection; it never
publishes images or removes unrelated resources. It does not establish resource
stress, restart recovery, Compose or the complete application workflow.
