# Native kernel control qualification

Manual, bounded qualification; never ordinary startup or the unit suite.
Use a completed public candidate record, an already available native engine image,
at least two Docker VM CPUs, and a new absolute evidence directory:

```sh
node --import tsx tools/qualification/resources/controls.ts PUBLICATION_JSON OUTPUT_DIRECTORY
```

An optional final local Docker context defaults to `default`. Image revision,
native platform and immutable root/child/config identities are checked before
work. The fixture does not pull/build images or select a user's installation.

Four sequential synthetic cases use the shipped attempt caps: one CPU, 512MiB,
no swap, PID128, read-only root, no capabilities, no new privileges and no network.
CPU burns four workers for eight seconds, with the aggregate cgroup counter and
throttling measured. Memory touches at most768MiB and must be cgroup-OOM-killed.
PID growth stops after at most160 small children and must observe both EAGAIN and
a cgroup limit event. Every issued child is reaped. A final case holds two actual
descendants, ignores TERM and requires bounded forced namespace shutdown.

Each case has a60s result deadline; issued CLI originals remain bounded to60s,
and cleanup can outlive that deadline. No late result passes. Outer supervision
uses the existing check runner with600s and bounded logs. Save the owner descriptor
before the first container; if a controller is externally killed, inspect only that
descriptor's exact ownership label. Never prune. Cleanup failure prevents a pass.

CPU reports a one-core denominator and permits one100ms cgroup period plus50ms
accounting tolerance. This is not a throughput minimum or the telemetry5% target.
All container logs/errors are private; `outcome.json` contains the closed result.
Direct kernel evidence does not establish installed-agent cause attribution,
admission/ledger recovery, resource observation accuracy, flood/soak or overhead.
Both architectures require actual native execution; no emulation claim is accepted.

Each worker reads VM-scoped `/proc/meminfo` before its fault and requires at least
1.5GiB available headroom. This is a qualification safety precondition, not a
minimum installation tier or an inference from Docker VM total memory.
