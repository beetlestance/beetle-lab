# Change installed run memory

This maintenance operation raises per-run/default memory within the existing
execution pool. It preserves history, credentials, retention, other settings and
organisation/workspace overrides. Stop backend and agent first. Active, queued or
unfinished work refuses the change; do not delete that work to force acceptance.

For a default Compose installation, build the reviewed source images, retain one
operation UUID, and run:

```sh
docker compose stop backend agent
docker compose run --rm --no-deps --entrypoint node setup \
  /beetle/install/compose-memory.js --memory-mib 1024 \
  --operation-id YOUR_OPERATION_UUID
docker compose up -d --no-build backend agent
```

Use the same Compose environment/home/images as initial setup. The command uses
the existing Compose configuration gate. Generate the UUID once with `uuidgen`;
keep it with the command's result. If the operation is interrupted, repeat the
identical command and UUID. An incomplete operation keeps serving fenced.

An advanced installation uses its original private provision request:

```sh
node /beetle/install/capacity.js \
  --request /private/setup/request.json \
  --agent-worker /beetle/install/agent-worker.js \
  --backend-worker /beetle/install/backend-worker.js \
  --memory-mib 1024 --operation-id YOUR_OPERATION_UUID
```

Run under the installation UID/GID with its original mounted paths. An explicit
`--docker-socket /absolute/path` selects the same verified daemon when running
outside the installer container. Do not edit the original request or receipts.
Use the matching source/image version that supports configuration generations.
An agent using an external operator configuration must be reconciled first;
this command refuses it rather than changing a policy that agent will not read.

The installed 1 GiB pool admits at most one 1 GiB run. This command does not enlarge
the pool, host VM, control containers or reserves. Existing workspace overrides
remain effective; select a 1 GiB run budget where a workspace overrides the default.
Ready output confirms committed configuration. Verify agent readiness after restart;
normal startup installs the policy and obtains fresh observations before admission.
See [the transaction contract](design/lld/installed-memory-change.md).
