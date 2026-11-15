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

For independent native CI, dispatch the registered `CI` workflow on
`rewrite/integration` with only `qualify_rewrite_release` set to a public
`rewrite-FULL_SHA-RUN_ID` installer tag. This mode skips ordinary source/build/
delivery jobs under distinct names; it cannot satisfy the normal `ci/*` gates.
It verifies the completed public asset's size/SHA and tag's source revision,
pulls only the native engine anonymously with an empty Docker config, and runs
these same probes on Linux AMD64 and ARM64. No images/releases are published.
Only `outcome.json` is retained; private errors, logs and owner files are excluded.
Failure or missing evidence stays failed. Normal CI and delivery defaults remain.

The optional `qualify_rewrite_profile=active-recovery` runs two fresh installation
profiles per native runner: crashes, then cancellation. It anonymously pulls the
six already published roles; no build or publication occurs. The default kernel
profile keeps its15-minute job ceiling. Active recovery has25 minutes overall,
two sequential300-second checks, and independent cleanup on failure/interruption.
Cleanup has a120-second result deadline per descriptor; original CLI calls remain
bounded to60 seconds, and its workflow step is capped at seven minutes for both
profiles. A late/uncertain cleanup cannot qualify a run.

Ownership is saved before Compose, with installation identity saved before any
offer. Cleanup validates exact project/revision/installation labels and bounded
full IDs, stops/removes only those peers, then removes owned engines, validated
mailbox volumes and project networks. It never prunes or removes source directories.
Only `public-outcome.json` is uploaded: fixed facts/identities/counts and sanitized
source locations, with actual harness revision/dirty state. Raw logs, private
exceptions, configuration, ownership files and database snapshots are excluded.
