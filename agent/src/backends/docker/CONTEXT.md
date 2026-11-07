# Docker adapter private contract

`index.ts` is the only cross-feature entrypoint. This adapter does not admit,
journal, stage files, start wrappers durably, finalize artifacts, or release capacity.

`prepareRuntime` validates shipped Offer/EngineManifest snapshots (1 MiB/64 KiB),
engine/image equality, minimum/install budget ceilings and approved entrypoint.
InstallationProfile is trusted installation configuration: UUID installationId,
immutable imageDigest, manifest-matching executable/arguments, numeric non-root
UID:GID, approved network (`none` or named `beetle-*` target-egress), bounded tmpfs,
absolute resolved stagingRoot and maximumBudget. Never derive these from job config.
`runtimeName` lets the staging owner derive the task directory after validating IDs.
StagedRoots must be resolved task-owned directories exactly
`<stagingRoot>/<runtimeName>/{input,output,secrets}`. Input/secrets mount read-only
at `/beetle/input` and `/beetle/secrets`; output is `/beetle/output`. The staging owner
must reject symlinks/verify realpath and ownership before supplying these private
paths. No filesystem staging occurs here. Job config belongs in staged input;
resolved secret values belong only in restricted staged secrets. Neither enters spec.

UnixDockerTransport accepts only an explicit Unix socket, API v1.47 operations,
64 KiB requests, 1 MiB responses, 4096 fragments, 16 KiB headers and 64 active requests.
Each composed operation shares the caller's monotonic `performance.now()` deadline,
clamped once to 30 seconds. Abort/deadline destroys request/response streams.
No mutation retries, host URLs, subprocesses, image pulls, daemon enumeration or logs.
Version min/max and Linux control flags are checked before use; actual enforcement
requires coordinator Linux qualification. Docker output/disk hard quota unsupported;
timeout/output guards require the future supervisor/wrapper and are not hard controls here.

ensureCreated never starts. Exact deterministic name, labels, image and actual
inspect controls/mounts are required for adoption. Missing differs from unavailable.
dispatchStartOnce requires created state. Persist durable start intent BEFORE calling;
the adapter's <=64 lifetime entry table retains create/start claims and unknown fences
without eviction. Duplicate starts, exited/restarting/unknown states cannot dispatch.
Recreating the adapter loses fences; one exclusive supervisor/journal owns recovery.
No claim of durable execution idempotence. stop accepts the supervisor's original
absolute graceDeadline; repeated calls must reuse it. stop/kill require stopped proof.
remove requires sealed/applicationAcknowledged evidence, exact stopped identity and
force=false/v=false; it never removes volumes. Exit137 alone does not establish OOM.

Tests: `npx vitest run agent/test/backends/docker --maxWorkers=2` (synthetic only).
