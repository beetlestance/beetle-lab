# Installation

How an installation is created, packaged and started, and which identities bind it.
`tools/install/` provisions offline and packages Compose first boot; the agent bootstrap and
`agent/src/installation-state/` own serving startup and journal authority; the backend binds
that authority to each delivery. Operator steps live in the [guides](../../guides/development.md).

## Trust boundary and topology

Setup and the agent hold Docker host control through the socket; setup, agent code and
administrators sit inside that boundary ([decision 018](../../decisions/018-docker-host-trust-boundary.md)).
The identity checks below reduce privileges; they do not sandbox socket access.

| Service | Network | Identity | Limits (CPU / memory / PIDs) | Mounts |
| --- | --- | --- | --- | --- |
| frontend | ingress + control; only `127.0.0.1:<port>` → 8080 published | UID/GID 101 | 0.1 / 64 MiB / 32 | none |
| backend | control (internal) | 1000:1000 | 1 / 256 MiB / 64 | config ro, backend data rw |
| agent | control (internal) | starts root with only `SETUID`/`SETGID`, drops to 1000:1000 + socket group | 0.25 / 256 MiB / 64 | config ro, journal rw, staging rw, published inputs ro, socket |
| setup | targets | starts root with `CHOWN`, `FOWNER`, `SETUID`, `SETGID` for empty-skeleton preparation, then drops | 1 / 256 MiB / 64 | home, socket |
| engine attempts | `beetle-<instance>-targets` bridge, never control | non-root, per-attempt spec | admission budget | staged inputs, output, scratch |

All services: read-only root filesystem, `cap_drop: ALL` plus the listed additions,
`no-new-privileges`, bounded `/tmp` (16 MiB) and logs. Every engine attempt container
(`agent/src/backends/docker/prepare.ts`) likewise has a read-only root, no privileged mode,
all capabilities dropped and none added, `no-new-privileges`, the admitted PID limit and a
bounded tmpfs; it joins only the target network and never gets the socket. Sources:
`docker-compose.yml` (ordinary first boot) and `compose.rewrite.yml` (explicit setup
profile). The frontend proxies only `/api/v2/` to `backend:4311` with buffering and upstream
retries off and a 2 MiB body limit (`web/container/nginx.conf`). The installation root has the same absolute path on the host and in setup, backend and
agent, because the daemon resolves engine bind sources. Staging is an exact private bind
(`rprivate`); the agent rejects ancestor mounts.

## Installation layout

| Path under root | Owner | Content |
| --- | --- | --- |
| `installation.json` | provisioner | receipt: version 1, operation UUID, installation UUID, request digest, phase `initializing`/`ready` |
| `config/installation.json` | provisioner, immutable | settings seed |
| `config/backend-agent.json` | provisioner | agent origin, token path, installation UUID, profile pins, storage ceilings |
| `config/agent.json` | provisioner | closed agent configuration with inspected daemon/image facts |
| `config/agent-token` | provisioner | 43–128 character base64url credential, never printed |
| `config/configuration-state.json` | capacity change | mutable selector ([resources](resources.md#offline-capacity-change)) |
| `backend/` | backend | `metadata.sqlite`, `inputs/{staging,published}`, `outputs/` |
| `agent/journal/journal.sqlite` | agent | journal and its authority UUID |
| `agent/staging/` | agent | per-attempt staging |

Files are 0600, directories 0700, single-link, no-follow, owned by the common positive
UID/GID. Nothing is recursively chowned, repaired or deleted on failure.

## Offline provisioning

`provisionFreshInstallation(request, context)` in `tools/install/index.ts` returns
installation ID, `created`/`unchanged` and paths; never a credential.

- Request: closed bounded JSON ≤ 256 KiB (`tools/install/types.ts`); fixed monotonic
  deadline ≤ 30 s; one operation per process; no retries.
- Docker use is read-only GETs of daemon info, agent image, engine image, optional export
  image and the named target network. Linux only; daemon and images share amd64 or arm64;
  image IDs are immutable SHA-256.
- The engine manifest template's `imageDigest` is replaced only by the inspected image ID.
  Profiles derive through the shared catalogue and installed identity.
- Commit order: exclusive `initializing` receipt first; private files; Journal opened
  through its public entrypoint (it generates its own authority); Journal configured with
  approved profiles; authority gate completed with that exact authority; all handles closed;
  receipt atomically becomes `ready`.
- Replay of a `ready` root is `unchanged` only after receipt, configuration, authority and
  image pins match the same request. It never rotates tokens or rewrites settings and never
  inventories runtime data. A serving lease causes `conflict`, not takeover.
- `inspectReadyConfiguration` validates receipt, configuration and pins without opening the
  Journal; it grants configuration readiness only.
- Failure codes: `invalid_input`, `inspection`, `unsafe_root`, `conflict`,
  `recovery_required`, `cancelled`, `deadline`, `io`, `cleanup`. The CLI exits 2 for
  argument errors and 1 otherwise, with fixed text. Partial roots are kept.
- The installer may import only public entrypoints of agent bootstrap, installation-state,
  journal, catalog, admission, Docker backend and backend configuration; runtime services
  never import the installer (`npm run check:architecture`).

## Compose first boot

`tools/install/compose/` is the setup entrypoint for `docker compose up`. The default home
is `$PWD/.beetle`, with the installation in its `data` child.

- A fresh root and every skeleton directory must be Docker-created `root:root` 0755; foreign
  ownership refuses before any mutation. Only proven empty skeleton directories are touched
  through retained descriptors.
- A separate bootstrap gate serializes configuration preparation; it is not Journal
  authority.
- Agent identity `socket-group-drop-v1`: the agent is PID 1, sets only the socket group,
  drops to UID/GID 1000 and verifies zero effective, permitted and ambient capabilities
  before agent code runs (`agent/src/bootstrap/container-identity.ts`). Staging verifies
  image, entrypoint, empty command, private PID namespace, no init, no privileged mode and
  only `SETUID`/`SETGID`.
- Fresh data delegates to the offline provisioner. A ready root is checked with
  `inspectReadyConfiguration`; serving never opens the offline authority owner. A second
  `up` preserves credentials, settings and history; pins never move.

## Starter policy

`tools/install/starter/policy.ts` supplies editable defaults, not measured capacity. Values
are CPU in millicores.

| Policy | CPU | Memory | PIDs | Other |
| --- | --- | --- | --- | --- |
| Pool | 2000 | 1 GiB | 256 | output 128 MiB, staging 128 MiB, concurrency 2, storage 2 GiB, free-space reserve 256 MiB |
| Per-run ceiling and default | 1000 | 512 MiB | 128 | timeout 300000 ms, output 64 MiB, staging 64 MiB |
| Control reserve | 1350 | 576 MiB | 160 | equals the backend, agent and frontend hard caps |
| Headroom | 250 | 128 MiB | 16 | output and staging 0 |

`maxConcurrent` 2, `maxTimeoutMs` 300000, `observationTtlMs` 1000, no required sensors,
retention `manual`. The k6 profile is `k6-v1`/`k6-local`, catalogue 1, config version 1,
tmpfs 16 MiB, controls cpu/memory/pids/timeout/output. Phases
validate/prepare/execute/collect/seal: prepare and execute use 300000 ms, the others 5000
ms; execute output 64 MiB, others 4 MiB. The placeholder image digest is never executable.

## Agent executable configuration

`BEETLE_AGENT_CONFIG_FILE` alone selects configuration
(`agent/src/bootstrap/installed-config.ts`):

- absolute canonical private file ≤ 256 KiB, fatal UTF-8, closed version 1 envelope; unknown
  keys reject; no environment interpolation;
- 1–32 engines, each pinned to a daemon-resolved local image ID; images that declare volumes
  reject; no tag or newer pin is selected on restart;
- journal directory owned by the process UID, mode 0700;
- credential file read through the shared private-file intake, at most 128 bytes, exactly
  43–128 base64url characters;
- listen defaults to `127.0.0.1:4312`; hosts `127.0.0.1`, `::1` or `0.0.0.0` (private
  container network only; never published).

Unknown capacity returns unavailable, never a fabricated catalogue. Diagnostics expose fixed
cause codes, never paths or secrets.

## Journal authority

| Rule | Owner |
| --- | --- |
| A new empty journal persists one random authority UUID; missing or malformed authority in an existing journal is recovery, never initialization | `agent/src/journal/` |
| Control store: separate SQLite outside backup paths, EXCLUSIVE locking, `synchronous=EXTRA`, 16 pages of 4096 bytes, 64 KiB cache, no mmap | `agent/src/installation-state/storage.ts` |
| `openServingState` accepts only `ready` and binds the opened journal's UUID before any execution owner starts; the serving facade has no mutators | `agent/src/installation-state/` |
| Capabilities publish `journalAuthority`; the backend persists it with the first possible delivery, before PUT; the binding is immutable | `app/src/adapters/outbound/runner/` |
| Expected authority travels in `x-beetle-journal-authority`, outside the Offer | `agent/src/transport/request-identity.ts` |
| Mismatch returns 409 `authority_mismatch`; a missing, duplicate or malformed header is 400 `invalid_protocol`; the agent's own capabilities self-check failing is 503 `authority_mismatch`; only an authenticated current-authority 404 `attempt_not_found` permits re-offer of the same original | `agent/src/transport/` |

Unknown or mismatched authority keeps every charge and forbids re-offer or a new attempt.
Restored history is read-only ([decision 016](../../decisions/016-historical-restore.md)).

## Installed identity

`Offer.installedIdentity` is required: `manifestId`, `profileId`, `catalogVersion`,
`manifestDigest`, `profileDigest`, `schemaDigest` (`contracts/src/installed-identity.ts`).
Digests are SHA-256 over `beetle-lab.installed-manifest.v1` or
`beetle-lab.installed-profile.v1`, LF, then canonical JSON ≤ 65536 bytes. The agent derives
them from its captured snapshots and never trusts supplied labels.

- New enqueue, prepare, start and recovery compare all six fields exactly.
- An identical accepted attempt replays its original snapshot before catalogue validation;
  conflicting contents reject.
- Records missing a binding are never synthesized or dispatched; drive reports
  `installed_identity` before any reservation.
- The browser-facing profile name is a backend alias, never the agent `profileId`.

## Installed providers

`agent/src/providers/` supplies input bytes and secrets from installation configuration
only, never from an HTTP job.

| Limit | Value |
| --- | --- |
| Private file read | 1–262144 bytes |
| Concurrent file leases per process | 2, no queue |
| Stream buffer | ≤ 64 KiB |
| Secret bindings / value | 256 / ≤ 64 KiB |
| Concurrent input streams | 256, then `busy` |
| Secret references per k6 configuration | ≤ 64, ≤ 128 KiB serialised (`prepareK6SecretReferences`); otherwise `unsupported_secret_reference` |

Input layout is `inputRoot/<organization>/<workspace>/<input>/<sha256>`; the Stager verifies
size and hash against the Offer. Private files must be regular, single-link, owner-only and
re-identified around reads. Providers never write, delete or `mkdir`. Failed close keeps its
lease forever and refuses clean close. A secret reference matches a binding only on its
exact organisation, workspace, name, provider, reference and version (case sensitive); an
unversioned reference matches only an unversioned binding, and a version is an operator
assertion, not content identity. Duplicate bindings reject, values pass byte-for-byte, and a
request alias never becomes an environment variable name or file path
(`agent/src/providers/capture.ts`).

## Installation controller

`agent/src/installation/` composes admission, staging and attempt controllers.

| Limit | Value |
| --- | --- |
| Generation entries | 64 |
| Outstanding public operations | 64 |
| Concurrent preparations | 2; saturation defers without failing |

- Accepted means durably queued or already accepted, never validated or passed.
- Admission precedes preparation; an admitted reservation stays charged while any original
  is uncertain. Launch requires successful preparation quiescence.
- A charged reservation without a create token is abandoned setup and is aborted, never
  restaged. Claimed work reconstructs its exact plan and must match the persisted spec
  digest.
- `cancel` and `stop` persist intent before signalling; replies do not claim termination.
  Close is cached and drains every original independently.

## Related

- Decisions [015](../../decisions/015-automatic-local-access.md), [016](../../decisions/016-historical-restore.md), [018](../../decisions/018-docker-host-trust-boundary.md); [Resources](resources.md), [Storage](storage.md)
- [Development guide](../../guides/development.md), [backup and restore](../../../site/src/content/docs/guides/backup-and-restore.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `tools/install/src/` | `9fe4e8822de1` |
| `tools/install/compose/` | `cbe88d78f424` |
| `tools/install/starter/policy.ts` | `05f116398b2b` |
| `agent/src/bootstrap/installed-config.ts` | `1975e2348c51` |
| `agent/src/installation-state/` | `0beedc07f9a0` |
| `contracts/src/installed-identity.ts` | `564605f73a36` |
