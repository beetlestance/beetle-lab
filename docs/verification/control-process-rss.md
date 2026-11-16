# Control-process RSS qualification

Verified sourceb48936d8, native Linux ARM64, Node24.22.3. Trial passed80.201s;
normal and independent cold cleanup both returned0. Frozen input hashes match.
Private bounded evidence: `.agent-work/control-rss`, including plan and report.

Observed VM:10CPUs,12526305280 bytes RAM, Docker29.9.3, Linuxkit7.0.14, cgroup2.
No host minimum or generic installation requirement is inferred.

Linux `ps` RSS is read through asynchronous bounded `docker top` calls outside
frontend/backend/agent containers. No extra Node process is injected into them.
Summed RSS counts shared resident pages more than once; it is distinct from
cgroup memory usage and unique physical memory. PID/command data is discarded.

| Phase | Frontend MiB | Backend MiB | Agent MiB | Samples per service |
| --- | ---: | ---: | ---: | ---: |
| idle | 9.91 | 153.21 | 129.54 | 7 |
| loaded | 9.91 | 159.96 | 139.75 | 32 |
| post-idle | 9.91 | 160.05 | 139.86 | 8 |

Declared ceilings remain64/256/256MiB respectively. Each phase/service had
at least two observations, and every observed sum stayed under its ceiling.
A summed-RSS miss would be an observation-target miss, not evidence that the
kernel failed to enforce a cgroup memory limit.

The existing fixture ran1VU/40physical iterations with three independent
settled-cadence readers. Target counts:1readiness/40work/0unexpected.
API p95:11.39ms idle,106.13ms loaded,9.90ms post-idle. Reader fresh frames9/9/8;
refusals2/2/4 remain recorded, so uninterrupted availability is not established.

Observer bounds:128points/120s, three exact inspected container IDs,10s/64KiB
per command. Sibling originals settle together; phase-crossing observations are
discarded; the observer drains before cleanup. Three focused tests cover units,
malformed/duplicate/oversized process facts and missing/over-ceiling observations.
Types, lint, architecture/docs and independent source review passed.

Scope: one short ARM run. Post-idle RSS remained above the initial idle peak;
no repeated-run plateau, no-retained-growth or telemetry off/on<=5% conclusion
is inferred. AMD RSS and those separate Q04 measurements remain open.
