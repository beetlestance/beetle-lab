# Staged attempt composition

Public `runStagedK6(options)` owns one container/job through original cleanup.
Trusted canonical input/secret/output roots, numeric UID, installed pins, optional
expected staging pins and parent signal never come from staged payload options.
Optional serial onEvent/onWindow callbacks must be bounded and cooperative.
No retry, new admission, reservation release or native-backend fallback occurs.
The real input loader binds headers; a fresh durable control journal precedes
compile. An existing journal/result refuses another invocation. Rejected journal
initialization has UNKNOWN quiescence because its owner exposes no original-work
receipt; it cannot produce a result or target work. Other issued original IO,
callback and descriptor outcomes are awaited, even when a public owner fails early.
Offer partition: control clamp(total/32,64KiB,64MiB), numeric1MiB,result64KiB,
summary1MiB; history quarter of remaining, <=256MiB; build remainder<=89MiB.
Execute phase also caps history; collect reserves summary1MiB/numeric1MiB plus
>=64KiB final-drain room before load. Preserve earlier history; charge only new
collect writes. Prepare caps peak build admission. See archive/CONTEXT.md.
Control is shared, separately reserved, never charged twice to phase artifacts.
Phase finishes report retained artifact bytes; numeric evidence separately retains peak.
Parser work ceilings64GiB/268435456 records are independent of retained output;
diagnostics64KiB, drain1000ms, collection<=30000ms. These unqualified installed
ceilings do not establish throughput, hard memory or physical disk guarantees.
Manifest phase deadlines never extend the original admitted wall/monotonic fence.
Validated measurement receipt starts execute retrospectively; confirmed-stop
collection callback starts collect. No execute phase is invented when marker is
missing. Serial journal append/fsync precedes notification; heartbeats have one
flight and no backlog. A failed notification disables further delivery; journal
remains authoritative. Original callbacks must settle before eligible sealing.
Fixed native numeric summary is rehashed against collector evidence after actual
stop. Native and fresh numeric-final files receive bounded IO/fsync/close and
exact bigint custody checks. They become eligible only through the atomically
published manifest. Partial files are preserved, never declared/refunded/deleted.
Numeric-final v3 binds history IDs, distributions/estimate provenance, coverage,
diagnostics and peak build bytes. Absent measurement quantiles stay unknown.
Published files remain reported even after terminal journal/notification failure.
Receipt ok means complete healthy coordination, never application test pass.
Native99 required failures can be healthy coordination with failed test outcome.
Check: scoped Vitest engines/k6/test/attempt and test/metric-archive; Node types.
Optional target observations reserve1MiB within existing output/collect ceilings.
Cooldown precedes collect; cleanup aborts and drains original sampler work.
