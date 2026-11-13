# Docker adapter private contract
Public index.ts; staging, durable start and capacity release belong to supervisor.
prepareRuntime snapshots Offer/EngineManifest (1MiB/64KiB), validates image/engine,
minimum/install ceilings and manifest-matching entrypoint. InstallationProfile is
trusted: installation UUID, immutable image, numeric non-root UID:GID, approved
none/beetle-* network, bounded temporary allocation, absolute stagingRoot, ceilings.
Live mailbox opt-in is trusted install metadata, never job/browser config. Its
local-driver tmpfs volume uses NoCopy and exact per-plan labels/options; its128KiB
comes from /tmp. No default profile enables it. Cold missing orphans without
creation-settlement proof remain charged; durable recovery precedes enablement.
effectiveImage pins imageDigest/defaultRuntime/public environment (64 unique entries,
4096 chars each/16KiB total), from approved daemon/image only; inherited PATH matches.
Create pins Env/Runtime/SIGTERM and disables healthcheck; known NONE timings accepted.
StagedRoots are <stagingRoot>/<runtimeName>/{input,output,secrets}; staging owner checks
physical paths/ownership. Input/secrets binds are recursively read-only/rprivate;
output writable. Kernel>=5.12 and daemon evidence required; no RO downgrade.
Secrets stay restricted; job config is staged, never forwarded as Docker flags.
Inspect normalizes only known API1.47 defaults/omissions; unknown overrides,
nonempty default-ulimits and disabled/missing OOM killer fail.
UnixDockerTransport uses explicit local socket/API1.47, ordinary64 slots, JSON
64KiB request/1MiB response/4096 fragments/16KiB headers and one<=30s deadline.
Mailbox archive uses <=2 ordinary slots with control headroom, <=5s, 96KiB actual
stream/256 fragments. It retains both request/response originals through physical
close after cancel/error. Fixed container-ID path; no retry, extraction or links.
TAR permits one bounded PAX header and exact regular mailbox extent. Frame semantic
validation and active-plan authorization belong to the caller, not raw transport.
ensureCreated never starts. <=64 non-evicted lifetime entries retain exact adopted
runtime ID/history/claims; each404 is issue-ID-bound and rechecked before use.
Retain positive identity before async volume verification; its failure cannot let old404s recreate work.
No same-attempt recreation after observation; dispatchStartOnce is created-only,
one dispatch; stale404 returns unknown, terminal/removal history wins over late IO.
Persist start intent first. One exclusive supervisor/journal owns recovery,
reservations and finalization; recreating the adapter loses in-memory fences.
stop retains first absolute graceDeadline rounded up; HTTP timeout cannot shorten
it. Observation expiry is unknown. stop/kill require stopped proof; remove requires
sealed/applicationAcknowledged, force=false/v=false; archive originals must drain.
Matched stop/kill works despite volume failure; reads/start/cleanup require ownership.
sampleResources reads inspected running owners by full ID, one-shot stats with raw
usage/null provenance; no mutation lane/revocation on failure. Exit137 is not OOM.
Control HTTP retains actual request/response/socket close before slot release,
including cancel/late response; destroy/timeout alone is not drain.
Focused tests:agent/test/backends/docker; no Docker in unit lane.
