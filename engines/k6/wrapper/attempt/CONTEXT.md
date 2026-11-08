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
Only enclosing agent/Docker containment can stop unresponsive original work.
Logical output partition: control clamp(total/32,64KiB,64MiB), numeric1MiB,
result64KiB, native summary1MiB, build remaining up to89MiB (minimum64KiB).
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
Numeric output retains totals, coverage, mapper diagnostics and build byte peaks.
Mapper, shared seal codec and publisher own their original respective semantics.
Published files remain reported even after terminal journal/notification failure.

Receipt ok means complete healthy coordination, never application test pass.
Native99 required failures can be healthy coordination with failed test outcome.
Safe typed failures, final facts and explicit quiescence distinguish unknown work.
CLI is Linux-only, umask077, fixed image paths/pins and one SIGINT/TERM cancel path.
Check: scoped Vitest engines/k6/test/attempt --maxWorkers=2; all TypeScript projects.
