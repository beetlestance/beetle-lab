# Local deployment configuration

Entry: `../local-cli.ts` exports `runLocalSetupCli(argv)`; the packaged executable
is `/beetle/install/local.js`. The POSIX launcher is `deploy/local/beetle`.

`config.ts` captures exact deployment pairs, derives stable instance/image/path
values and delegates request policy/validation to the existing starter owner.
`files.ts` owns bounded, private, exclusive, no-follow filesystem IO and retains
native descriptors until close settles. `setup.ts` creates or verifies matching
setup files and reads ready receipt/config integrity without opening Journal or
acquiring installation authority. It never updates runtime settings or credentials.

Directories0700/files0600 must belong to the current positive UID/GID. Reads and
writes are capped at256KiB/64 calls; directory reads use exact finite name limits.
A30s monotonic deadline and captured signal fence operations. Native originals
settle/close before success; close/sync errors fail visibly. Partial/conflicting
state is preserved for explicit recovery, never repaired or deleted.

The launcher uses only local Unix Docker daemons. Only up builds/configures and
initializes a fresh root. Ready up preserves image pins and skips offline setup.
Stop/status/token use the existing explicit environment file without sourcing it;
status creates no containers. Source builds are serial, bounded to five recipes,
and never change the saved Docker context or default builder.

Focused checks:
`vitest run tools/install/test/local-{config,cli,launcher}.test.ts --maxWorkers=1`.
Launcher tests use task-owned Unix sockets and fake Docker, never real Docker.
Real image/Compose/browser qualification belongs to the integration coordinator.
