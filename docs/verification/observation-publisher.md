# Full resource and guard publisher evidence

Date: 2026-11-09. Integrated source: `cde60f6`.
Reviewed publisher candidate: `12d3bcb`, integrated as `bd18d7c`.
Environment: Node26.7.0/macOS arm64, real temporary filesystem and SQLite;
Docker replies and engine execution remain controlled.

## Implemented path

`createObservationPublisher` composes resource observation with both running output
and timeout guards. It preserves original capacity timestamps/provenance, strips
incoming guard claims and publishes full observations through journal admission.
Neither constructor presence nor a resource observation alone grants guard readiness.

One original sample, one original write and one pending frame bound work. An
independent polling interval invalidates readiness on guard loss, sample deadline,
clock failure or local freshness expiry. Unknown observations take precedence over
pending known candidates; epochs prevent invalidated originals restoring readiness.
Resource reads can remain held while unknown revocation reaches the journal.

Local monotonic start time bounds freshness, including a held first known write.
Known observations retain their actual wall timestamp; the publisher never increments
timestamps or re-dates cached capacity. Equal/older samples cannot restore known
state after revocation. Recovery requires a newer complete actual sample with both
guards ready. Frozen-wall conflicts conservatively leave admission unavailable.

Original write rejection or invalid acknowledgement is sticky. Close fences callbacks,
aborts sampling, drains independent originals and finally publishes full unknown
revocation. Only clean revocation releases the local per-journal publisher owner.
Observer, guard, transport and journal lifetimes remain externally owned.

## Review and composition checks

Coordinator inspection found two pre-review gaps: no independent freshness owner
for a first held known write, and stale ready status during reentrant polling.
The submitted implementation retains that frame's original start and returns false
during reentrant status. Regression fixtures cover both cases.

Independent review verified 28 frozen read hashes and passed five additional probes:
held first-write expiry, frozen-wall monotonic expiry/recovery, invalidated recovery
samples, independent sample/write close drains, and invalid final acknowledgement.
Its 33-test observation run, Node typecheck and scoped lint passed. No blocking
finding remained. Coordinator matched 23 frozen source/spec/test hashes; the public
index additionally exports the reviewed factory.

Real-composition fixtures use the actual ResourceObserver, OutputGuard, TimeoutGuard
and reopened journal. An unstarted timeout service keeps admission unknown; starting
it and obtaining newer actual evidence permits admission. Closing it revokes admission
while an actual observer transport original is held. Publisher close waits for that
original and durably revokes readiness. Daemon version/info replies remain synthetic.

The private HTTP manual/scheduled/overflow execution fixtures now use this actual
observer/publisher composition instead of fabricated resource/guard observations.
Staging, output scanning, control/output verification and SQLite remain real;
Docker execution, daemon capacity replies and engine-result production are controlled.

## Executed checks and limits

`npm run verify:v2` exited 0 on `cde60f6`: **2455 tests/213 files**, all three
TypeScript projects, lint, generation 37/23/6, architecture 709, docs 114 and frontend
build. Tests took 119.05s. The existing 611.56kB/178.59kB gzip chunk warning remains.
Focused observer/publisher/composition checks passed 30 tests/3 files; subsequent
private HTTP and real composition checks passed 5 tests/2 files.

This proves local composition and ordering, not native enforcement, Docker startup,
stack overhead, full-pool stop latency, irreversible recovery fencing or complete
application artifact/finalization behavior. Packaging, architecture qualification,
scans, backup and soak remain. No hosted CI, publication or deployment is claimed.

## Committed capability projection

Source `29351ddcc10ad267ff85b3cd15a9fcb9174247b4` adds the publisher's immutable
committed snapshot and removes CapabilityView's raw observer cache. A pending
resource result cannot upgrade advertised capacity before its stored acknowledgement.
Expiry is tied to the original cycle's wall start, with monotonic and wall checks;
reads and acknowledgements cannot renew it. The final frame is bounded to16KiB.

Focused publisher/bootstrap/SQLite integration checks passed48 tests in5 files;
the final lease-focused file passed15 tests. Cases cover held acknowledgements,
old-frame retention, freezing/no alias, guard loss, rollback, both expiry clocks,
late completion, reentrant reads, shutdown ownership and final size/expiry failure.
Node typechecking, lint, architecture and documentation checks passed. Independent
source review found no blocker. The agent rebuild and compiled smoke exited0,
including private configuration, authenticated capabilities and clean shutdown;
the Docker daemon remained a fixture.

This is component evidence, not a new full-suite or native-control qualification.
The most recent complete suite remains the3,160-test run at `63d2783` recorded in
[installed binding](installed-binding.md). Source timestamps/global pool limits
are not yet on the runner wire; that bridge and application dispatch remain pending.
