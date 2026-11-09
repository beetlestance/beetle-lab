# Runner capacity observation

Status: required first-release wire contract in implementation. Runner1.0 is
unreleased; there is one required observation, with no timestamp-free fallback.
Schemas own exact shapes. [Publisher](observation-publisher.md) owns committed
source authority; [resources](resources-observability.md) owns admission policy.

## One response, one source

Capabilities.capacity remains the sole per-run Budget. The required observation
contains installation/daemon/policy identity, source and clock model, original
cycle start, resource observation time and absolute expiry; effective global pool,
per-run staging allowance, maximum concurrency and provenance; actual runtime
controls and composed guards; optional idle/thermal facts and thermal policy.
Per-run limits are clipped to the global pool. Pool includes staging and subtracts
control reserve/headroom exactly once. It is total allowed capacity, before active
reservations; never report current free slots as a replacement total ceiling.

Projection uses only ObservationPublisher.snapshot. Expiry is the minimum of its
original expiry and original sample start plus configuration observationTtlMs.
GET time and acknowledgement time cannot renew any source. Source start <= resource
time <= expiry; guards cannot be future-dated. Refuse absent, expired, malformed or
exhausted facts with503, rather than an empty successful catalogue. Repeated reads
preserve times/digest while returning private copies to transport consumers.

The clock model is local-shared-wall: first-release containers share one host/VM
wall clock. This declares a deployment assumption, not clock synchronization proof.
Receivers preserve original age through parsing and worker queues, reject future/
expired observations and revoke on rollback. Sensor source times remain separate;
stale, future, missing or null sensors never imply idle/thermal readiness. The agent
still owns the final atomic admission decision and its sensor-policy checks.

## Identity and evidence

policyDigest is lowercase SHA256 of UTF8 prefix `beetle-lab.capacity-policy.v1`
followed by LF and bounded canonical JSON of `{configuration, installedIdentities}`.
Configuration is the captured complete PoolConfiguration; identities follow the
installed catalogue order. Canonical input is <=128KiB. Derive this once from actual
private snapshots, never a supplied digest label. It exposes no raw profile paths,
provider locations or credentials and authenticates nothing.

CPU/RAM provenance describes daemon/VM totals; PID/output/staging ceilings are
configured policies. physicalPidCapacity stays null. Runtime controls describe
Docker CPU/memory/PID support; timeout/output come from actual guard owners.
Neither a configured output ceiling nor its monitor is a hard filesystem quota.
Synthetic provenance is explicit fixture evidence, not native qualification.

freeStagingDiskBytes belongs to the agent's verified staging filesystem. It is not
backend metadata/input/artifact storage capacity. The backend needs its own pinned
data-root statfs observation and configured allocation/reserve. A live free-space
refusal and the configured total allocation are distinct facts.

## Receiver requirements and pending composition

Before use, compare expected installation and installed engine tuples. Validate
shape, cross-field limits, time ordering, expiry and provenance; schema success
alone is not freshness or control attestation. Controls must agree with their source
facts. Retain original Offer pins through possible delivery, never select a newer
profile because a later capability response changed.

The backend cache must revoke on out-of-order or conflicting equal-time facts.
An identical equal-time replay cannot extend expiry; unknown/revoked state needs
a strictly newer source. Keep one bounded observation and scalar fences. Original
source expiry and the backend's maximum age both constrain use; no receipt stamps.
Trusted private configuration, bounded HTTP ownership, backend disk observation,
SQLite handoff and dispatcher remain required follow-on implementation.

Acceptance: strict closed required wire vectors; unchanged source age on repeated
GET/held ACK; pool versus per-run/concurrency/staging; one overhead subtraction;
configured versus measured provenance; no invented PID/quota/sensors; actual policy
hash sensitivity/order invariance; wrong installation/pins, future/expired/conflicting
frames and separate-volume cases before enabling application delivery.
