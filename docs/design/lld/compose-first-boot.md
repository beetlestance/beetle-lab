# Ordinary Compose first boot

Status: implementation contract on the rewrite branch; no release publication.
Extends [fresh installation](fresh-installation.md); the advanced source launcher
and explicit offline provisioner remain available.

## Distribution and ownership

Normal source use is docker compose up from the canonical checkout directory.
Separate frontend/backend/agent and performance/export images retain their owners.
Compose supplies an explicit starter policy, automatic loopback-only session,
private configuration and the fixed offline export mapping. Image pull/release
qualification is separate; no mutable tag may replace an existing installed pin.

The default dedicated home is PWD/.beetle, with an absolute canonical override.
The real installation is its data child; a separate bounded bootstrap gate keeps
configuration preparation exclusive without impersonating Journal authority.
Host and container paths remain identical for sibling engine bind sources.
Reject symlink roots, substitutions, unexpected entries and mismatched custody.

## First preparation and process identity

Compose creates bind-source directories before starting dependencies. The packaging
entry may prepare only the finite known empty mount skeleton through retained
no-follow directory descriptors. It removes only these proven-empty directories
before the existing initializer creates its normal private layout. Fresh root and
every skeleton directory must have Docker-created root:root0755 custody; foreign
ownership/modes are refused before any mutation. It never recursively chowns or repairs existing
content. Once content exists, exact private ownership/layout is required; partial
or conflicting initialization remains visible and fails without data deletion.

Runtime UID/GID are1000:1000. Installer/agent packaging may begin as root solely
for fresh directory preparation and Unix-socket supplementary-group setup. Inspect
the actual socket, set only the needed group, drop UID/GID, and verify effective
identity/capability removal before existing non-root startup code executes.
The agent/setup process is PID1 without a persistent root init parent.
Failure at any step refuses startup. Never chmod the socket or run engine jobs as
root. Declare the preparation and identity-drop capabilities separately in Compose.

Compose explicitly installs agentIdentity socket-group-drop-v1. Staging verifies
the pinned agent image/name and the exact packaging entrypoint, empty command,
private PID namespace, disabled init/privileged mode, only SETUID/SETGID, dropped
other capabilities and no-new-privileges. It also verifies the current process is
PID1 with actual UID/GID1000 and zero effective/permitted/ambient capabilities.
Docker's configured startup user remains root for this recipe. Other installed
agents retain the existing non-root configured-user check; no root exemption is
inferred from a running container. Build and validate the starter request after
privilege drop so existing provisioner ownership validation remains authoritative.

## Ready startup

Fresh empty data delegates to the existing explicit initializer and its receipt,
image catalogue, actual Journal configuration and authority-gate completion.
An existing ready installation uses shared read-only receipt/config/image-pin
validation; it must not open the offline Journal/authority owner while serving.
Serving startup still verifies its own real gate and Journal identity. A ready
configuration check never grants authority or repairs a missing gate.

The performance and offline image seeds complete before initialization. Missing
images, changed pins, malformed configuration, busy bootstrap gate or interrupted
receipt fail closed. A normal second up preserves credentials, settings and history.
The installer never treats mutable runtime data as unknown installation content.

## Proof

Scoped fixtures cover root replacement/ownership/partial state, exclusive setup,
privilege-drop failures, exact profile mappings and ready configuration checks
while the Journal is owned. Actual native Compose proof must include empty first
up, automatic session, one ordinary k6 run and one public offline export, unchanged
second up/restart, non-root running services, same staging path and exact cleanup.
No synthetic check establishes shipped-image, browser, amd64 or release readiness.
