---
title: Back up and restore history
description: Take a cold backup of an installation and open it later as a read-only history viewer.
sidebar:
  order: 4
---

A backup captures an installation's data while it is stopped. A restore unpacks a
backup into a **new** location that you open as read-only history. Restoring never
replaces a running installation and never repeats old runs.

:::note
This workflow is a release candidate. Use images that match the installation, and
an installation provisioned by the current setup. Older development data is not
adopted automatically.
:::

The examples assume `BEETLE_HOME` is `/srv/beetle`. Use your own absolute path
throughout; paths in the requests must match those inside the maintenance
container. The default runtime user is `1000:1000`.

## 1. Stop the installation

```sh
docker compose stop backend agent
```

The backup checks that both the backend and the agent are offline, that every run
has settled and that no engine container is still running. It never stops
services or repairs unfinished work for you.

## 2. Write a backup request

Create a private request file as the installation's runtime user:

```sh
docker compose -f compose.recovery.yml run --build --rm --no-deps --entrypoint sh recovery \
  -c 'umask 077; cat > "$BEETLE_RECOVERY_HOME/backup-request.json"' <<'JSON'
{"version":1,"command":"backup","source":"/srv/beetle/data","destination":"/srv/beetle/backup-001","limits":{"maximumBytes":1073741824,"maximumEntries":10000},"timeoutMs":600000}
JSON
```

The destination must not exist yet and must be outside the data directory.

## 3. Run the backup

```sh
docker compose -f compose.recovery.yml run --rm --no-deps backup \
  --request /srv/beetle/backup-request.json
```

On success it prints the backup's identity and manifest digest. Then restart the
installation:

```sh
docker compose up -d
```

:::caution[Keep backups private]
Suites and artefacts can contain sensitive data. Mounted secret files and the
agent credential are left out, and browser sessions are removed from the copied
metadata, but treat the archive as confidential.
:::

The byte limit bounds the archive itself, not all temporary disk use. Compacting
SQLite needs extra space, which is why the example works in the installation's
home rather than the maintenance container's small `/tmp`.

## 4. Restore into a new location

Write a second request the same way, named `restore-request.json`, with a fresh
operation ID that you keep:

```json
{"version":1,"command":"restore","archive":"/srv/beetle/backup-001","destination":"/srv/beetle/history-001","operationId":"aee23e82-90d0-44d0-9551-2606149c8536","limits":{"maximumBytes":1073741824,"maximumEntries":10000},"timeoutMs":600000}
```

Restore does not need Docker access:

```sh
docker compose -f compose.recovery.yml run --rm --no-deps recovery \
  --request /srv/beetle/restore-request.json
```

If a restore is interrupted, add `"resume":true` to the **same** request, keeping
the operation ID, archive and destination, and run it again. A resume that finds
unknown files or a half-initialised destination refuses; restore into another new
location instead. Resuming a restore that already finished only verifies it.
Partial backups are never resumed; keep them apart from complete ones.

## 5. Open the history

Run the history viewer as the same user that restored the data:

```sh
BEETLE_HISTORY_ROOT=/srv/beetle/history-001 \
  docker compose -f compose.history.yml up --build -d
```

Open <http://127.0.0.1:4568>. The viewer is a separate Compose project with its
own sign-in, no agent and no Docker access. The UI marks it read-only: runs,
results, inputs and artefacts are readable; starting runs and every change are
refused. Live capacity and effective settings are shown as unavailable rather
than rebuilt from old observations.

| Setting | Default | Purpose |
| --- | --- | --- |
| `BEETLE_HISTORY_PORT` | `4568` | Published loopback port |
| `BEETLE_HISTORY_INSTANCE` | | Name of another viewer project |
| `BEETLE_HISTORY_USER` | `1000:1000` | Runtime user |
| `BEETLE_HISTORY_LIVE_ORIGIN` | | Optional **Back to live** link on restored Results. Use the live installation's canonical loopback or HTTPS origin. |
| `BEETLE_HISTORY_MAXIMUM_BYTES`, `_MAXIMUM_ENTRIES`, `_TIMEOUT_MS` | | Startup limits |

Stop it with the same environment and
`docker compose -f compose.history.yml down`. Do not move a restored directory;
to view history somewhere else, restore the archive again at the new path.
