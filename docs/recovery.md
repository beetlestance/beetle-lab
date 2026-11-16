# Backup and restored history

The first release restores read-only history into a **new destination**. It never
replaces an installation or replays its old execution requests. Ordinary local
installation still uses `docker compose up --build -d`.

Use matching current images and a provisioned installation. Older development
roots without the backend recovery control are not automatically adopted. Keep
existing data; do not delete gates or create them manually to force a backup.

## Cold backup

The examples assume the installation's existing `BEETLE_HOME` is `/srv/beetle`.
Substitute its actual absolute path everywhere; configuration paths must remain
unchanged inside the maintenance container. Default runtime ownership is1000:1000.

Stop the installation's writers first:

```sh
docker compose stop backend agent
```

Create a private request using the installation's runtime user:

```sh
docker compose -f compose.recovery.yml run --build --rm --no-deps --entrypoint sh recovery \
  -c 'umask 077; cat > "$BEETLE_RECOVERY_HOME/backup-request.json"' <<'JSON'
{"version":1,"command":"backup","source":"/srv/beetle/data","destination":"/srv/beetle/backup-001","limits":{"maximumBytes":1073741824,"maximumEntries":10000},"timeoutMs":600000}
JSON
```

Run the packaged offline command:

```sh
docker compose -f compose.recovery.yml run --rm --no-deps backup \
  --request /srv/beetle/backup-request.json
```

The destination must not exist and must be outside the installation data root.
The command checks both real offline leases, terminal settlement and stopped Docker
originals. It never stops services or repairs pending work. A successful response
identifies the backup and manifest digest. Restart the original installation when
maintenance is finished:

```sh
docker compose up -d
```

Keep archives private. Test configurations/artifacts can contain sensitive data;
mounted secret files and the agent credential are excluded. The copied metadata's
browser credentials are removed. The byte limit bounds the logical archive, not
all temporary disk use. SQLite compaction needs additional disk; the example uses
the existing private disk-backed home instead of the maintenance container's small `/tmp`.

## Fresh historical restore

Write another private request with the same request-file command, changing its
filename to `restore-request.json`. Supply a fresh operation UUID and retain it:

```json
{"version":1,"command":"restore","archive":"/srv/beetle/backup-001","destination":"/srv/beetle/history-001","operationId":"aee23e82-90d0-44d0-9551-2606149c8536","limits":{"maximumBytes":1073741824,"maximumEntries":10000},"timeoutMs":600000}
```

Restore requires no Docker socket; use the plain entrypoint:

```sh
docker compose -f compose.recovery.yml run --rm --no-deps recovery \
  --request /srv/beetle/restore-request.json
```

Keep the archive unchanged. Resume an interrupted copy by adding `"resume":true`
to the **same** request, preserving operation ID, archive and destination. Resume
requires an intact claim/control and the exact claimed native directories. Unknown
files or a partial control initialization refuse; use another fresh destination.
An already completed resume verifies data without rewriting it. Partial backups
are not resumed or auto-adopted; keep them separate from complete archives.

## Open historical data

Use the final restored path and the same numeric user that performed restoration:

```sh
BEETLE_HISTORY_ROOT=/srv/beetle/history-001 \
  docker compose -f compose.history.yml up --build -d
```

Open `http://127.0.0.1:4568`. This separate Compose project publishes only a
loopback frontend port and has no Docker socket or agent. Authentication is fresh
and separate; normal local browser access is automatic. The UI marks the view as
read-only. Stored Runs, results, inputs and artifacts are readable; execution and
all configuration/data mutations refuse. Live capacity and effective settings
are unavailable rather than synthesized from archived machine observations.

`BEETLE_HISTORY_PORT` changes the published port; `BEETLE_HISTORY_INSTANCE` names
another viewer project. `BEETLE_HISTORY_USER` defaults to1000:1000. The byte/entry
limits and startup timeout have corresponding `BEETLE_HISTORY_MAXIMUM_BYTES`,
`BEETLE_HISTORY_MAXIMUM_ENTRIES` and `BEETLE_HISTORY_TIMEOUT_MS` settings.
Stop it with the same environment and `docker compose -f compose.history.yml down`.
Do not move a completed historical root: restore its portable archive afresh at
its intended final path/environment. [The LLD](design/lld/cold-recovery.md) explains
native custody and failure fences. Broader release/platform qualification remains
separate from this candidate workflow.
