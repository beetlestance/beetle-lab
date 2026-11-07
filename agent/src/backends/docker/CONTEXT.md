# Docker adapter private contract
`index.ts` is the cross-feature entrypoint; no admission, journal, filesystem staging,
durable wrapper start, artifact finalization or capacity release occurs here.
prepareRuntime validates shipped Offer/EngineManifest snapshots (1 MiB/64 KiB),
engine/image equality, minimum/install budget ceilings and manifest-matching entrypoint.
InstallationProfile is trusted install input: installation UUID, immutable imageDigest,
numeric non-root UID:GID, approved network (none or named beetle-* target-egress),
bounded tmpfs/shared memory, absolute stagingRoot and maximumBudget.
Required effectiveImage pins the same imageDigest, defaultRuntime and public image
environment (<=64 unique KEY=value entries, <=4096 chars each, <=16 KiB UTF-8 total).
The install owner obtains this complete baseline from the approved image/daemon;
never derive it from Offer.config, browser environment or resolved secrets. PATH may
be inherited and must match. Create pins Env/Runtime, disables Healthcheck with NONE,
uses SIGTERM and rejects unapproved effective inspect values/host options.
StagedRoots are trusted resolved task-owned directories exactly
<stagingRoot>/<runtimeName>/{input,output,secrets}, mounted at /beetle/{input,output,secrets}.
Staging owner verifies realpath, symlinks and task ownership; no staging occurs here.
Input/secrets require forced recursive read-only, rprivate binds; output is writable.
Kernel >=5.12 and daemon defaultRuntime/control evidence are required; no RO downgrade.
Job config belongs in staged input; resolved secret values only in restricted secrets.
Inspect normalizes only known API1.47 omissions: NetworkDisabled false, disabled
network's empty/null attachment map, zero/false bind options and empty omitted map options.
Unknown host/mount overrides fail; actual resource/security/mount/network values match.
UnixDockerTransport: explicit Unix socket/API1.47; 64 KiB request/1 MiB reply,
4096 fragments, 16 KiB headers, 64 active requests; no URLs/retries/pulls/subprocesses/logs.
All composed steps share the caller's monotonic performance.now() deadline, clamped
once to 30s. Finish rechecks it even if timers stall; abort/deadline destroys streams.
ensureCreated never starts. <=64 non-evicted lifetime entries retain exact adopted
runtime ID, terminal/removal/disappearance history and uncertain create/start claims.
No same-attempt recreation after observing a runtime; dispatchStartOnce is created-only,
one dispatch, never exited/restarting/unknown or previously observed running/terminal.
Persist durable start intent BEFORE calling. Recreating the adapter loses these fences;
one exclusive supervisor/journal owns durable recovery, reservations and finalization.
No durable execution-idempotence claim. stop retains the first absolute graceDeadline,
rounds remaining grace up to seconds and never shortens it to the HTTP deadline.
Observation expiry is unknown. stop/kill require stopped proof; remove also requires
sealed/applicationAcknowledged evidence and force=false/v=false, never volume removal.
Exit137 alone is not OOM. Actual Linux enforcement still requires qualification.
Output/disk hard quota unsupported; supervisor/wrapper owns timeout/output byte guards.
Tests: npx vitest run agent/test/backends/docker --maxWorkers=2 (synthetic only).
