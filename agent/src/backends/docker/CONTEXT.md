# Docker adapter private contract
`index.ts` is the cross-feature entrypoint; no admission, staging, durable wrapper
start, artifact finalization or capacity release occurs here.
prepareRuntime validates shipped Offer/EngineManifest snapshots (1 MiB/64 KiB),
engine/image equality, minimum/install budget ceilings and manifest-matching entrypoint.
InstallationProfile is trusted install input: installation UUID, immutable imageDigest,
numeric non-root UID:GID, approved network (none or named beetle-* target-egress),
bounded tmpfs/shared memory, absolute stagingRoot and maximumBudget. Trusted
liveMetricMailbox opt-in splits128KiB/four inodes into private /beetle/live; absent
opt-in preserves /tmp. It never comes from job config or increases a budget.
Required effectiveImage pins the same imageDigest, defaultRuntime and public image
environment (<=64 unique KEY=value entries, <=4096 chars each, <=16 KiB UTF-8 total).
The install owner obtains this baseline from the approved image/daemon; never from
Offer.config/browser environment/resolved secrets. Inherited PATH must match. Create pins Env/Runtime, disables Healthcheck with NONE,
uses SIGTERM; exact NONE allows known nonnegative safe-integer timing/retry metadata.
StagedRoots: <stagingRoot>/<runtimeName>/{input,output,secrets} -> /beetle/{input,output,secrets}.
Staging owner verifies realpath, symlinks and task ownership; no staging occurs here.
Input/secrets require forced recursive read-only, rprivate binds; output is writable.
Kernel >=5.12 and daemon defaultRuntime/control evidence are required; no RO downgrade.
Job config belongs in staged input; resolved secret values only in restricted secrets.
Inspect normalizes only known API1.47 omissions: NetworkDisabled false, disabled
network's empty/null attachment map, zero/false bind options and empty omitted map options.
OomKillDisable null means the default enabled OOM killer; true/missing/nonboolean reject.
Unknown overrides and nonempty daemon default-ulimits fail.
UnixDockerTransport: explicit Unix socket/API1.47; 64 KiB request/1 MiB reply,
4096 fragments, 16 KiB headers, 64 active requests; no URLs/retries/pulls/subprocesses/logs.
All composed steps share the caller's monotonic performance.now() deadline, clamped
once to 30s. Finish rechecks it even if timers stall; abort/deadline destroys streams.
ensureCreated never starts. <=64 non-evicted lifetime entries retain exact adopted
runtime ID, history and claims. Each 404 binds to its issue-time ID, rechecked before return/use.
No same-attempt recreation after observing a runtime; dispatchStartOnce is created-only,
one dispatch; old pre-discovery 404 returns unknown; terminal/removal history wins over late replies.
Persist durable start intent BEFORE calling. Recreating the adapter loses these fences;
one exclusive supervisor/journal owns durable recovery, reservations and finalization.
stop retains first absolute graceDeadline, rounding remaining grace up to seconds;
HTTP deadlines cannot shorten grace. Durable idempotence belongs to the supervisor.
Observation expiry is unknown. stop/kill require stopped proof; remove also requires
sealed/applicationAcknowledged evidence and force=false/v=false, never volume removal.
sampleResources reads only inspected running owners by full ID, bounded one-shot
stats; raw usage/null provenance. No mutation lane or ownership revocation on failure.
Exit137 is not OOM. Native enforcement remains unqualified; no hard output quota.
Tests: npx vitest run agent/test/backends/docker --maxWorkers=2 (synthetic only).
