# k6 engine image

Build from the repository root for the local Docker target platform:

```sh
docker build -f engines/k6/Dockerfile -t beetle-lab-k6:local .
```

This is a one-shot Linux engine for one admitted staged attempt. Its entrypoint
is `node /beetle/bootstrap/main.js`, running as UID/GID `1000:1000`. The CLI owns
umask `077`, SIGINT/SIGTERM cancellation and the attempt lifecycle. It exposes no
ports and runs no health daemon. Agent admission and launch wiring are separate.

The trusted agent supplies these canonical mounts with ownership matching UID1000:

| Image path | Purpose |
| --- | --- |
| `/beetle/input` | Read-only offer, manifest, staging metadata and numbered inputs |
| `/beetle/secrets` | Read-only referenced secret files, separate from inputs |
| `/beetle/output` | Fresh writable mode0700 directory, exclusively owned for this attempt |

The agent must prevent concurrent path replacement. No sample attempt, secret,
output or engine manifest is baked into the image. The installed native binary
is `/usr/local/bin/k6`; the immutable empty config is `/beetle/image/empty.json`.

Node24 Alpine and k6 `2.2.0` use pinned multiarchitecture image indexes. Docker
selects the target k6 binary. The build stage uses BUILDPLATFORM to run the
reviewed `build:k6` tool. Its JavaScript bundle and raw runtime/plan sources
are packaged in the final image. Those sources live at `/beetle/runtime` and
`/beetle/plan` for the admitted runtime-script build.

Production dependencies are installed separately on TARGETPLATFORM using the
repository lock and engine/contracts workspace selection. Runtime esbuild is
exactly `0.28.2` and remains external to the CLI bundle. `npm ci --include=optional`
installs its Linux target architecture package; the recipe verifies that package
resolves and requires Node24. `--ignore-scripts` suppresses lifecycle downloads;
no binary from the build host is copied into production dependencies. Workspace
metadata and contracts sources preserve the installed local dependency links.

This recipe does not establish native architecture, container durability or
CPU/RAM/PID/timeout/output-control qualification. Those require separate image
execution and agent control checks; the legacy application image is unchanged.
