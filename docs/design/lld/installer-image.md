# Offline installer image packaging

Status: next packaging component; first-boot Compose wiring follows separately.
Owning provisioning contract: [fresh installation](fresh-installation.md).

## Responsibility

A separate finite installer image packages the existing strict CLI and its actual
agent Journal/backend metadata workers. Serving images do not initialize or repair
authority. No provisioning algorithm, worker implementation or schema is copied.
No production dependency on synthetic fixtures. Root coordinator owns build files.

tools/build-install.ts bundles three ESM Node24 entrypoints into tools/install/dist:
main from tools/install/cli.ts; agent-worker from agent/src/journal/worker.ts;
backend-worker from app/src/adapters/outbound/sqlite/worker.ts. Use existing tsup
configuration conventions and explicit worker URLs supplied by packaging arguments.
The image builds from repository root using the existing pinned Node24 base;
only bundles and LICENSE enter the runtime stage. No host node_modules or private
installation state enters its context. No runtime package installation.

## Execution

Default uid/gid1000:1000; deployment supplies the common positive installation
uid/gid and Docker socket supplemental group where required. Entrypoint fixes
--agent-worker /beetle/install/agent-worker.js and --backend-worker
/beetle/install/backend-worker.js; caller adds --request ABS_PRIVATE_FILE.
The existing CLI enforces exactly these three arguments, a private <=256KiB request,
fixed <=30s deadline, signal cleanup and bounded credential-free result/error output.
No automatic guessed defaults, chown, Docker mutation, service startup or retry.
Root filesystem read-only and bounded /tmp/resource/log settings are deployment
responsibilities. Docker inspection is read-only at the application capability;
mounting the socket itself still grants powerful daemon access to the container.

The installation root and staging bind source must retain the same absolute host
path inside Docker: engine binds are interpreted by the daemon. Request files,
private installation state, socket access and engine/network image identities must
be wired explicitly by the later Compose/starter component.

## Evidence

Independent source review plus one cached native image build. Execute the actual
compiled CLI with invalid/missing request arguments: exit2 fixed invalid_input,
no setup effects, no network or socket needed. This proves packaging/entrypoint,
not fresh provisioning or first-boot usability. Actual installer/Journal/Docker
composition, interrupted install behavior, resource measurements and native amd64
remain separate qualification. Never publish or replace legacy image defaults here.
