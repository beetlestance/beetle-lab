# Full resource and guard observation publisher

Status: frozen implementation contract; not yet integrated or qualified.
Public entrypoint: `agent/src/observation/index.ts`.

One publisher per journal composes the actual ResourceObserver, OutputGuard and
TimeoutGuard. The bootstrap starts both guards before the publisher. Constructors
or resource samples alone never grant output/timeout readiness. Public options are
trusted composition ports, not caller-supplied job data or serialized capabilities.
The publisher owns no lifecycle, reservation, configuration or deletion mutation.

One interval defaults to250ms (10..5000). Sample timeout defaults to1000ms
(10..30000); freshness TTL defaults to2000ms (100..300000), strictly greater than
interval and sample timeout. At most one original sample and one original journal
write run independently, with one bounded pending observation. No waiting queue,
overlapping sample retry, detached original or retained observation history.
Input options use fixed known data fields; sample snapshots are bounded to16KiB.
Unknown pending observations take priority over known candidates.

Each sample records local monotonic and wall time BEFORE invoking the observer.
Known observations preserve the observer's original observedAt, source, capacity
and provenance. observedAt must lie between the cycle's wall start and current
valid wall time; local sample age must remain below TTL. Incoming guard fields are
discarded, timeout/output entries are removed from runtime controls, and both
actual guard statuses are checked before and after sampling/publication. Known
publication adds only the controls those live owners currently establish. Neither
guard being ready is sufficient alone. Idle/thermal evidence is never invented.

A guard failure, elapsed local resource freshness or sample deadline independently
invalidates readiness even when the original sample or previous write is held.
Publish a full unknown observation with zero capacity, unavailable CPU/RAM/disk
provenance, null daemon/PID capacity, no guards and no controls. It is an explicit
failure observation, not a new resource measurement. Timestamp it with an actual
valid wall sample; after clock failure use the retained wall high-water without
claiming current time. Existing journal equal-time conflict rules revoke readiness
even when the wall clock is coarse or frozen. Never increment timestamps to obtain
an ordering or re-date cached capacity to refresh it.

Invalidation fences older sample completions by a local epoch. Guard loss during
a recovery sample invalidates that sample too. Recover only from a subsequent
complete, fresh sample while both guards are ready. Known publication must be
strictly newer than every observation previously submitted by this publisher;
equal-time/older known samples cannot restore readiness. Track one scalar high-water,
not a history. The publisher exclusively owns full observation writes after reopen;
bootstrap configures admission separately and journal reopening clears observations.

Periodic polling and status reads check freshness independently of resource I/O.
Stop writing after an original journal rejection/invalid acknowledgement: retain
failure, abort the sample, resolve initial false, refuse clean close. Do not retry
an unknown journal mutation. Return ready only after a fresh known publication was
acknowledged as stored, with no later invalidation, failure or shutdown. A read-only
status call cannot manufacture committed readiness. Bound reentrant callbacks and
check shutdown fences after clocks, guard statuses and original completions.

Close is cached and synchronously fences polling/new sample issuance. Abort and
drain original samples and writes independently; late results cannot restore known
state. Then submit one final full unknown revocation, preserving timestamp rules.
Only its successful acknowledgement permits clean close and release of the local
publisher registry owner. Failed revocation keeps ownership and rejects close.
Initial resolves false on close even while originals remain held. The external
bootstrap closes observer, guard, transport and journal services separately.

Acceptance: actual observer/guards/journal admission composition; no readiness from
unstarted/failed guard; guard loss and TTL revoke while resource or journal original
is held; stale/future samples and equal/frozen wall cannot restore; subsequent fresh
sample can recover; one-sample/one-write/pending bounds; no fabricated thermal/idle;
original retention, cancellation, failed writes and reentrant shutdown. Controlled
Docker replies and clocks do not establish native latency, capacity or stop guarantees.
