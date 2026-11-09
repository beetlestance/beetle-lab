# Backend connection to the execution agent

Status: components and executable connection implemented; qualification and dispatch remain pending.
This owns private configuration, backend HTTP custody and combined capacity facts.
[Agent HTTP](agent-http.md) owns remote routes/auth; [capacity wire](capacity-wire.md)
owns source evidence; [run intake](run-intake.md) owns immutable execution intent.

## Private configuration and ownership

Keep BEETLE_CONFIG_FILE as the installation settings record. Add a separate required
BEETLE_AGENT_CONFIG_FILE for normal executable operation; programmatic authoring
fixtures may omit the connection and retain unknown capacity. The new closed JSON
object contains version1, origin, tokenFile, expectedInstallationId, profiles,
storageAllocationBytes and freeSpaceReserveBytes. profiles uses existing
RunProfilePin objects, 1..32 unique browser profile aliases and installed identities.
Expected installation must equal the installation record. Aliases do not substitute
for installed engine/image/configVersion or any of the six identity fields.
Configuration carries references only, never resolved engine secrets.

Private JSON <=64KiB and token <=129 bytes use no-follow, nonblocking regular-file
handles, one link, owned UID and no group/world access. Bound read calls and bytes;
reject changed file identity/size/metadata across reading. Token syntax is the
existing agent bearer syntax, with at most one terminal LF. Token path is absolute,
canonical and installation-owned; never expose it or its value in browser responses,
error text, URL, logs or public diagnostics. Failed/unknown close retains custody.
Origin is an explicitly configured HTTP origin <=2048 characters, with no credentials,
path beyond /, query or fragment; no browser-controlled address. First release
uses the private Compose network; do not publish the agent port.

The bootstrap owns file intake and the canonical existing private data root;
outbound adapters receive captured values and cannot rediscover configuration.
Startup must reject inconsistent profiles/storage policy before opening normal
traffic. Changed files require restart; never silently repin a pending Offer.

## Public application ports

ports/runner.ts defines AgentConnectionConfiguration, RunnerGateway and a scoped RunnerAttemptClient. Capturing
RunnerAttemptIdentity copies/validates organization, workspace, attempt, generation
and intent digest from the persisted attempt. All clients share connection credits;
creating a facade grants no new credit and does not cache an unbounded identity map.
Generated createRunnerClient and runner schemas remain the wire/DTO authority.

Offer/cancel/ACK bodies must agree with the captured identity before network issue.
Snapshot replies must match the full captured identity. Event batches/ACK receipts
and protocol errors must match every scope/attempt/generation field they contain;
validate every returned event. A mismatch is a response failure, never authoritative
remote state. No schema or identity failure becomes a fabricated ProtocolError.
Capabilities must match expected installation and exact configured profile bindings
before capacity use; an unexpected or ambiguous installed entry cannot replace a pin.
Normal capacity use requires docker-info CPU/RAM, configured-policy PID/output/
staging, statfs disk and all five actual composed controls; synthetic labels never
establish production readiness. Fixture values remain explicitly synthetic evidence.
A valid capabilities response alone does not authorize dispatch.

Public factories are loadAgentConfiguration(path, installationId):
Promise<LoadedAgentConfiguration> in bootstrap/agent-configuration.ts;
createRunnerGateway(loaded: LoadedAgentConfiguration): RunnerGateway in outbound/runner;
and openCapacitySource(options: CapacitySourceOptions): Promise<CapacitySource>
in outbound/capacity. Port types own their inputs; bootstrap wires these factories.
The capacity source owns its root handles and samples, while the gateway remains
shared and is closed separately by bootstrap. Neither discovers environment values.

openApplication optionally receives agent:{connection,dataRoot}, privately captured
before awaits. The data root must be the metadata parent and configured input root
parent; the installation identity must agree. Agent mode starts metadata unknown
and uses the captured private profile registry. Programmatic authoring may omit it.
Normal executable loading requires the agent file and supplies this option.
[Publication loop](runtime-polling.md) owns sampling and SQLite refusal/recovery.
Shutdown drains that loop/source, then gateway, before closing metadata, preserving
all failure causes. Repeated propagation of the same error object preserves its
original identity; distinct failures still aggregate. server.close follows the
same owned-resource path. Input paths are captured before any startup await.
runtimeState is bounded publication diagnostics, not permission to dispatch.

## Original HTTP custody

Use the Node HTTP adapter with no redirects, automatic retries, proxies, cookies,
keepalive pool or response decompression. Bound headers to16KiB/32 fields. Reuse
shared bounded JSON encoding and generated validators rather than a second schema
implementation. Offer request maximum is the shared2MiB envelope; ordinary requests
<=64KiB and responses <=1MiB, with <=4096 received fragments. Refuse conflicting or
invalid lengths/encoding, excess bytes, incomplete EOF and unexpected status.

Retain at most two original Offer calls and eight ordinary calls, with no waiting
queue. Saturation is a typed transport failure before request serialization/network
issue. Logical deadline is5000ms; abort/close destroys owned requests but retains
credit and the original promise until native custody settles. DNS resolution is
an owned bounded original too: await its actual completion after abort, never start
a request from a late result, and use only the selected result for that request.
Bound returned address collections to8; no address fallback retry of mutations.
Retain request and response socket close, including aborted/partial replies.
No Promise.race or logical fetch abort can prove original completion.
close fences intake, aborts owned calls, waits for all original DNS/socket work,
and retains its own original promise. No exception details or URL/token leaks.

## Backend disk and capacity source

ports/runtime.ts owns RuntimeObservation and CapacitySource. Keep the SQLite
adapter's existing type re-export; there is one private observation ABI.
One source sample at a time, no waiting queue. Keep one bounded fingerprint and
scalar ordering/revocation fences for the original capability frame: identical
equal-source replay cannot renew it; changed equal-time or older frames revoke,
requiring a newer source. This protects wire fields not present in derived ceilings.
Capture wall time before reads;
retain original filesystem/network promises through abort and shutdown. Unknown
or failed inputs produce null, never a successful empty or guessed observation.

Pin the canonical private data-root device/inode/UID/mode. Verify it before and
after bigint statfs; reject replacement, symlink, ownership/mode drift, negative
available blocks or unsafe products. Backend storage policy requires positive safe
allocation, nonnegative reserve and allocation > reserve. Total allowed storage is
min(configured allocation, filesystem total bytes); reserve remains policy.
Available bytes are a separate live refusal fact, not a replacement total ceiling.
At or below the configured reserve, sampling returns null; never advertise free
bytes as total allocation. Existing byte owners still handle write-time exhaustion.
Never use the agent staging filesystem as backend metadata/input/artifact space.

Combine agent CPU/RAM/PID/output/concurrency and per-run limits with that backend
storage policy. Supported profile aliases come only from matched configured pins.
The source time is the earliest start among required reads; expiry is the earliest
original agent expiry and earliest required source start+1000ms.
This conservative aggregate lease is <=1s from its oldest source. Identical
cached-agent samples retain identical source time and expiry across disk reads;
changed same-time ceilings revoke, and disk polling cannot renew an old source. Every source remains valid
at completion; cached agent observations retain their original time/expiry.
Do not require optional idle/thermal evidence for displaying capacity; agent atomic
admission owns those policies. Missing required resource/control evidence revokes
capacity. Future/expired/rollback or conflicting sources cannot gain freshness
through polling, parsing, worker queueing or receipt time.

This source reports total ceilings before reservations. User installation pool and
concurrency remain additional dispatch limits, never raised to runtime maxima.
Agent admission is the final physical authority. Persisted claim, possible delivery,
ACK/projection and finalization require their own separately reviewed transactions.

Acceptance: private config/token failures and redaction; wrong installation/pins;
actual loopback partial/oversized/stalled/aborted requests and shutdown; credit
retention through native close/DNS; no retry after lost reply; separate backend/
agent filesystem facts; replaced root, stale/future sources and original expiry.
Synthetic transport/filesystem cases do not prove native container qualification.
