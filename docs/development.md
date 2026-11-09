# Rewrite development startup

The released app still uses `npm start`. These commands run the new namespace,
settings, suite authoring and input HTTP surface; run execution and Docker installation remain incomplete.
Use Node 24 and install the locked development dependencies with `npm ci`.

## Create a private development installation once

From the repository root:

```sh
mkdir -m 700 -p .agent-output/dev
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const fixture = JSON.parse(await readFile('contracts/fixtures/api/valid/installation-settings.json', 'utf8'));
const { effective, ...installation } = fixture;
installation.id = randomUUID();
await writeFile('.agent-output/dev/installation.json', JSON.stringify(installation), { mode: 0o600, flag: 'wx' });
JS
```

This creates synthetic development settings, not a measured engine resource profile.
Keep this file and installation identity when restarting an existing database.
The JSON contains `id`, `version:1`, `schemaVersion:2`, installation `scope` and
`values` matching the generated `InstallationValues` contract. It has no `effective`
field or resolved secrets. Existing installations keep their persisted UI settings.

## Start backend and frontend

```sh
npm run build:api
BEETLE_CONFIG_FILE="$PWD/.agent-output/dev/installation.json" \
BEETLE_DATA_DIR="$PWD/.agent-output/dev" \
BEETLE_EXTERNAL_ORIGIN=http://127.0.0.1:5173 npm run start:api
```

In another terminal run `npm run dev:web`, then open `http://127.0.0.1:5173`.
The development proxy preserves Host and forwards `/api/v2` to port 4311. Enter the
one-time token printed by backend startup. Tokens expire after 15 minutes or one use;
sessions last 8 hours. Logout/expiry requires restarting the backend to pair again.

Only a fresh, trusted agent observation can resolve effective resource settings.
Until that integration exists, settings may show capacity unavailable; startup does
not substitute the host machine size or pretend that an engine ran.

Backend defaults to loopback port 4311. `BEETLE_LISTEN_PORT` selects 1–65535;
`BEETLE_LISTEN_HOST=0.0.0.0` is reserved for the private backend container network.
The externally visible origin must remain canonical loopback in this release.
The data directory must exist, belong to the backend user and have mode 0700.
Config must be regular, single-linked, 32 KiB or smaller and not group/other writable.
Startup creates private `inputs/staging` and `inputs/published` children. Existing
unsafe roots are rejected. Pending publication/deletion is recovered in bounded
background pages; ordinary published inputs are not periodically rehashed.
The browser input interface is still pending.

## Check the built entrypoint

After building, `npm run smoke:api` starts an owned backend on a temporary loopback
port with disposable synthetic storage. It checks pairing, namespace access, full-size
suite revision save/read/replay, metadata edits, a two-chunk input upload,
publication, terminated chunked download, deletion, logout
and SIGTERM cleanup; it never starts k6 or contacts a target. It requires permission
to bind that loopback port. CI runs build and smoke after the main verification gate.
This does not qualify browser cookies, container controls or either Linux architecture.

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
