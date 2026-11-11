# Explicit local starter descriptor

Status: accepted implementation contract for the next installation component.
Depends on [fresh provisioning](fresh-installation.md) and [image packaging](installer-image.md).
No default published image or legacy install is replaced.

## Interface and ownership

Public tools/install/starter.ts exports StarterOptions and createStarterRequest.
StarterOptions contains exactly the scalar deployment fields from ProvisionRequest:
root, uid, gid, externalOrigin, agentOrigin, dockerSocket, agentContainer, agentImage,
engineImage, targetNetwork. createStarterRequest(options) returns a detached bounded
ProvisionRequest with explicit shipped starter settings, pool policy and k6 manifest.
No daemon calls, filesystem writes, credentials, services, measured-capacity claim
or synthetic fixture dependency. Existing provisioning performs actual inspection,
final capture, schema/catalogue validation and authority initialization.

A tools/install/starter-cli.ts entry accepts exactly --options ABS_PRIVATE_FILE.
Use the existing bounded private request-file reader and fixed30s abort/deadline;
handle SIGINT/TERM and retain original IO ownership. Validate closed scalar input
and generated request with existing validators/owners rather than clone provisioner
logic. On success stdout is one canonical <=256KiB request JSON with no credentials.
Fixed invalid_input stderr/exit2 for argument errors; fixed private code/exit1 for
read/validation/cancellation/deadline failure. Do not emit raw paths/errors/options.
No output file is opened: installation instructions redirect under umask077 and
noclobber, preserving an existing request. Worker owns starter.ts, starter-cli.ts,
feature-local helper modules and tools/install/test/starter*.test.ts only.
Coordinator owns build scripts/Dockerfile/Compose, public contract and integration.

## Shipped policy

These are editable initial policy values, not discovered available resources or
qualified minimum hardware. No automatic adoption of idle host cores or sensors.

- Pool: CPU2000 millicores, memory1GiB, PID256, output128MiB, concurrency2,
  retained storage2GiB, disk reserve256MiB.
- Per run ceiling/default: CPU1000 millicores, memory512MiB, PID128,
  timeout300000ms, output64MiB. Profile k6-local. Retention manual.
- Agent admission pool matches CPU/memory/PIDs/output; staging128MiB. Per-run
  staging64MiB. Control reserve CPU600/memory576MiB/PID160; output/staging0.
  This matches Compose caps: backend/agent each CPU250,memory256MiB,PID64;
  frontend CPU100,memory64MiB,PID32. These are hard ceilings, not idle measurements.
  Headroom CPU250/memory128MiB/PID16; output/staging0. MaxConcurrent2,
  MaxTimeout300000ms, observationTtl1000ms, requiredSensors[].
- k6 image template version2.2.0, protocol1.0 range1.0..1.0, http capability,
  Docker backend, target-egress network, cpu/memory/pids/timeout/output controls.
  Actual config schema ID comes from createK6ConfigSchema; result schema is the
  shipped EngineResult ID. node /beetle/bootstrap/main.js, no shell command.
  Default budget matches per-run default; minimum CPU1000/memory512MiB/PID128,
  timeout1ms/output1byte. Placeholder imageDigest sha256 followed by64 zeros is
  replaced only by actual provisioning inspection; it is not an executable pin.
  Five phases validate/prepare/execute/collect/seal: workUnits100 each.
  Prepare and execute use the default budget timeout300000ms: native k6 JSON
  buffering can delay the measurement-start marker during low-volume runs.
  Execute output is64MiB; other phase output is4MiB. Validate/collect/seal
  timeouts are5000ms. The overall Offer deadline and
  admitted output ceiling still apply; phase ceilings never grant extra resources. Manifest ID k6-v1/profile k6-local/catalog1/config1;
  tmpfs16MiB. No fabricated image digest after provisioning.

Settings can be edited in the generated private request before first provisioning.
Existing installation settings UI remains the application owner afterward; changing
static admission policy on an installed agent is a separate lifecycle operation.
Users can select lower pool limits; admission compares actual fresh daemon facts
and fails/defer explicitly when policy and machine availability cannot admit a run.

## Focused evidence

Test exact defaults/identity/schema, detached values, closed/bounded malformed
input, unsafe paths/UID/GID/origins/images/names, private reader behavior and CLI
argument/fixed-output errors. Reuse existing bounded IO tests; do not repeat the
entire provisioning suite. One composed generated-request/provisioner fixture test
checks accepted schema/catalogue semantics without claiming a real installation.
No full native image build belongs to the worker. Coordinator later bundles the
CLI once and connects explicit private options/request mounts to Compose.
