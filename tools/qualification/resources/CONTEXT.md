# Native resource qualification

`controls.ts` uses an explicit published candidate, existing local Unix Docker
context and immutable platform identities. It saves exact ownership before work;
only labelled synthetic containers are cleaned. No network, volumes, daemon prune,
image build/pull or user-service mutation. A single heavy lane owns these probes.

`programs.ts` contains finite isolated CPU, cgroup-OOM, PID and descendant fixtures.
`values.ts` rejects unsupported controls/security, unsafe counters, missing throttle
or PID-limit evidence; configuration alone is not pressure qualification.

Read README.md and docs/execution/resource-parity.md before execution. Obtain
independent review before faults. Native platform, source/digest, effective controls,
measurements, status and cleanup must all be captured. A failed/late/unclean probe
never qualifies. Raw diagnostics stay private. These are kernel proofs, not agent
cause/reservation, cross-org scheduling, backup, flood/soak or overhead acceptance.
