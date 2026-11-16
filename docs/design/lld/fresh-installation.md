# Explicit fresh installation provisioning

Status: implemented offline provisioning contract. Existing serving
startup keeps refusing a missing or interrupted authority gate. This component
creates private installation files and a fresh agent journal; it does not start
services, qualify Compose, migrate data or update an existing installation.

## Owner and interface

Public entry: tools/install/index.ts. provisionFreshInstallation(request, context)
returns installationId, status created/unchanged and bounded configuration paths.
No credential value is returned or logged. context contains required signal,
monotonic deadline and trusted compiled agentWorkerUrl/backendWorkerUrl. The caller supplies a
DockerTransport capability; all requests made by provisioning are read-only GETs.
Root owns this interface, build/config files and architecture boundary amendments.

Request is closed, bounded JSON data (<=256KiB): root absolute canonical path,
positive uid/gid, canonical externalOrigin, private agentOrigin, Docker socket path,
agentContainer name, agentImage reference, engineImage reference, targetNetwork,
installationValues (generated InstallationValues), agentPolicy (PoolConfiguration
without profiles), and engine {manifest,manifestId,profileId,catalogVersion,
configVersion:1,tmpfsBytes}. The supplied manifest is an explicit installed-engine
template; replace its imageDigest only with the inspected engine image ID. Its
schema must equal the shipped k6 config schema. No production test-fixture import,
whole-environment snapshot or guessed host capacity/default resource pool.

An optional exportEngine supplies a separate inspected image, sourceProfileId and
engine template with standalone-export-v1 capability, export-result schema and
networknone. Configuration derives both installed identities through the shared
catalogue; backend exportProfiles maps the performance alias to the offline pin.
The optional agentIdentity socket-group-drop-v1 is explicit packaging input; see
[ordinary Compose](compose-first-boot.md) for its runtime verification.

The initializer handles one performance k6 profile, Linux amd64/arm64 and a common
non-root uid:gid for backend/agent/engine. User budgets/pool/retention are explicit
installation values; later UI changes remain owned by existing settings storage.
Compose supplies the separately specified starter template/default policy.
Do not claim that caller policy describes measured capacity or a qualified minimum.

## Container client

A thin tools/install/cli.ts entry accepts exactly --request ABS_FILE,
--agent-worker ABS_FILE and --backend-worker ABS_FILE. Request file is bounded,
private, regular/single-link and no-follow; worker URLs are trusted packaging
arguments. Construct the existing UnixDockerTransport only from captured socket
configuration. No host dependency install or whole environment read. SIGINT/TERM
aborts the captured operation and waits owned cleanup. Print only ProvisionResult
on success; fixed private code on stderr/exit1 on failure (invalid arguments exit2).
Build recipes/Compose invocation are subsequent coordinator-owned work.

## Inspection and capture

Capture/validate scalars and bounded JSON before asynchronous work. Snapshot options
and bind supplied capability methods; caller mutation cannot change admitted work.
The offline caller launches one operation per owned root; an exclusive receipt
is its admission claim. No global queue/retries. Use a fixed <=30s deadline and captured
abort signal. Native originals remain owned until actual settlement after abort.

Inspect only named daemon/info, agent image, engine image and target network through
existing bounded UnixDockerTransport. Never pull/tag/build images, create/start/
stop containers or alter networks/Docker configuration. Require Linux; daemon and
both images share amd64/arm64 architecture, IDs are immutable SHA256, and daemon
ID/default runtime/engine effective environment are validated. Match the exact
requested target network name. No arbitrary URL/shell command or Docker CLI shell.

Use shared createK6ConfigSchema/deriveInstalledIdentity and actual inspected image
facts. Profile uses root/agent/staging, caller uid:gid, template entrypoint,
target-egress network and explicit tmpfs/max budget (installation perRunCeilings).
Validate budget/manifest/profile compatibility via existing catalogue and Journal
configuration owners rather than duplicating admission/compiler policies.

## Private filesystem and commit

The caller supplies an existing empty root owned by uid (or an exclusive new child
under an owned private parent), mode0700, canonical/no symlink. This component does
not chown a foreign directory or accept shared/temp-prefix ownership as proof.
All parents/children/files use existing bounded no-follow private IO patterns;
files0600, directories0700, regular/single-link files and pinned parent identity.
Run as the requested uid/gid; container wrappers may prepare ownership separately.

Layout under root:

- config/installation.json: generated InstallationSettings seed without effective.
- config/backend-agent.json: backend private agent origin, token path, matching
  installation UUID, actual installed profile pins and explicit storage ceilings.
- config/agent.json: existing closed agent configuration with actual daemon/image
  facts; journalDirectory root/agent/journal; stagingRoot root/agent/staging.
- config/agent-token: fresh43..128 character base64url credential, shared by the
  private backend/agent only; never hardcoded, returned or printed.
- backend/: backend data; backend/inputs/staging and backend/inputs/published
  already private, with published root reused as agent provider inputRoot.
- agent/journal and agent/staging: separate private agent authority/runtime roots.
- installation.json: bounded private receipt with version1, operation UUID,
  installation UUID, request digest and phase initializing/ready.

Create exclusively; reject pre-existing foreign/partial content. Write the
initializing receipt before other effects; use bounded writes, actual fsync/close
and parent sync before claiming publication. Keep original descriptors owned across
abort/failure. Never remove user data, recursively repair permissions, replace
credentials or turn an interrupted installation into fake success.

Use loadAgentConfiguration, openJournal and initializeInstallationState through
public entrypoints. Journal generates its own authority. Configure the fresh
journal with the validated policy and catalogue's approved profiles, then complete
the authority gate with that exact journal authority. Providers/journal/gate and
native originals close before the receipt atomically becomes ready. No serving
openAgentRuntime/listener/container launch is part of provisioning.

Provisioning and unchanged replay are offline operations; a serving authority
lease causes conflict, not forced takeover. A ready re-invocation is unchanged
only after bounded receipt/config/authority
identity validation with the same captured request and immutable image pins.
Do not inventory/re-hash runtime backend/agent data to reject legitimate user files. It
must not issue mutating settings/run commands or rotate credentials. Normal
SQLite open/close/checkpoint IO is not a byte-for-byte file preservation claim. An initializing receipt,
unknown receipt/config files, changed pins/policy, missing expected file or unsafe custody fails
with a fixed recovery_required/conflict classification. Explicit interrupted-init
recovery/update/restore remains a separate operation; no fallback or automatic reset.

inspectReadyConfiguration(request, context) reuses receipt, private configuration
and inspected pin checks without opening the Journal/authority owner. Its result
contains installationId, paths and readiness configuration_only. It does not grant
serving authority, repair a missing gate or validate mutable runtime state.

## Composition boundary

Production installer may import only named public entrypoints from agent/bootstrap,
agent/installation-state, agent/journal, agent/catalog, agent/admission and
agent/backends/docker, plus backend/bootstrap/configuration for validation. Runtime
services must never import the installer. No private storage/SQL imports, copied
compiler/catalogue/authority implementation, global install or root dependency edit.

Docker packaging must mount agent staging at the same canonical absolute
host/container path: sibling engine bind sources are interpreted by the daemon.
Backend published inputs are shared read-only with agent; credentials/config are
private mounts. [Ordinary Compose](compose-first-boot.md) owns packaging and
first-boot orchestration; its qualification does not follow from this helper.

## Failure and verification

Fixed private codes: invalid_input, inspection, unsafe_root, conflict,
recovery_required, cancelled, deadline, io, cleanup. Never echo credentials,
configuration/environment values, untrusted Docker replies or raw exceptions.
Failures preserve their original cause internally; cleanup failures retain custody
and cannot be reported as success. Deadline never resets between inspection/files/
Journal configuration and final receipt. No rollback deletes partial directories.

Scoped tests use synthetic daemon/image/network replies and task-owned directories,
actual private files/Journal/authority gate and generated backend/agent loaders.
Verify coherent identities/digests, shared input-root layout, private modes,
unchanged replay, no settings/token mutation, malformed/foreign/partial/symlink/
hardlink roots, changed images, abort/held originals, short IO/failed close and
interrupted receipt. Assert every transport call is read-only and scope-bounded.
No Docker/build/fullsuite/native/browser qualification by inference. Coordinator
reviews source once, verifies one changed composed initializer/loader seam, then
archives and removes the accepted task worktree/branch.
