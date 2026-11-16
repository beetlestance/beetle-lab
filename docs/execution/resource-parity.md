# Resource and parity qualification

Scope: remaining R0–R4 qualification, followed by evidence-backed closure of all
36 F/N IDs, A01–A09 and V01–V24. No UI redesign or follow-on engine work.
Existing published candidate `72243a87` has matching native AMD64/ARM64 and twelve
actual browser phases; reuse those proofs where relevant inputs are unchanged.

| Packet | Required result |
| --- | --- |
| Q01 kernel controls | Actual CPU quota under demand, cgroup OOM, PID refusal and bounded descendant shutdown; native architectures recorded separately. |
| Q02 runner lifecycle | Actual advertised controls/correct known-or-unknown causes through the installed agent; cancel/progress, shared/isolated admission, charged uncertainty and active-phase crash recovery. |
| Q03 bounded load | Flood/slow readers/high cardinality, declared-pool parallel runs, 30-minute stream/three subscribers, final drain and repeated-run/post-idle growth. |
| Q04 overhead | Frontend/backend/agent separately, idle and loaded; API p95 target250ms, service memory ceilings and telemetry on/off wall target5%; misses analysed, never silently raised. |
| Q05 storage/recovery | Controlled ENOSPC/interrupted upload/publication/delete, cold default-UID source/pull backup, historical-only restore, exact resume and supported image/schema/data rollback. |
| Q06 feature parity | Remaining executor/data/assertion/secret/target-observation fixtures and keyboard/theme/viewport/cross-scope browser checks; map exact source/platform/evidence per ID. |
| Q07 closure | Review every inventory/acceptance/adversarial ID, distinguish supported limits from missing proof, reconcile stale ledgers and obtain independent final review. |

One heavy local lane; native runner jobs may execute independently when capacity
is established. Use current recipes/published immutable identities; do not duplicate
full suites/builds for prose or unchanged runtime inputs. Keep full private logs and
only safe closed reports in public evidence. Each packet freezes its budget before
execution. Remove merged task trees/branches after preserving evidence.

## Recorded progress

[Q01](../verification/resource-controls.md) has native AMD64/ARM64 direct-kernel
proof at clean harness68d9f989. [Q02a](../verification/active-recovery.md) has scoped
packaged ARM64 active crash/cancel, emitted-resource and cold counter evidence.
Clean23bb8c82 native AMD64/ARM64 active profiles now pass in CI43756923411.
[Q05a](../verification/packaged-cold-recovery.md) adds default-UID native ARM
packaged backup/history/resume and AMD64 anonymous-pull proof (CI43758727985). These are scoped results; Q02 overall and Q03–Q07
remain open. [Q04a](../verification/short-control-overhead.md) records accepted Node24 ARM
short control latency and descriptive CPU/memory observations. Earlier Node26
target misses remain recorded; uninterrupted readers, full overhead and Q04
overall remain open. [Native independent polling](../verification/short-control-overhead.md)
now passes both architectures. The [actual long stream](../verification/long-stream.md)
failed its fresh-frame-span gate; quota replay records a reproduced mechanism.
[Browser interaction acceptance](../verification/browser-interactions.md) adds
actual Chromium keyboard/theme/viewport/scope checks; broader matrices remain.
[Bounded full-storage input recovery](../verification/bounded-disk.md) adds native
ARM tmpfs refusal/prefix recovery and same-intent deletion after explicit restart;
other storage faults and platforms remain open.
[Native engine parity](../verification/native-engine-parity.md) adds scoped ARM
six-executor, discovery, SLO, assertion and transport outcome proofs; remaining
data/secret/operator/platform matrices stay open.
[ARM native shared/isolated admission](../verification/native-parallel-admission.md)
adds exact two-organisation overlap, third-request queue/cancel and isolated release
proof under the stock pool; other platforms/races remain separate.
[Actual ARM reference/download acceptance](../verification/browser-reference.md)
adds four file hashes, static route checks and shipped skill notices.
[ARM source-candidate cold history](../verification/source-cold-history.md) adds
foreign-resume conflict and verified older historical-reader compatibility; no
mutable or future-incompatible rollback is implied.

## Q01 frozen scope

Use the current public engine image, one native Linux container at a time, no
network, read-only root, no capabilities, 1CPU, 512MiB, swap0 and PID128. These
are the shipped attempt limits, not a smaller convenient substitute. Use bounded
synthetic programs and explicit container IDs/ownership labels; never daemon prune.

CPU: four busy workers for eight seconds, read actual quota/cumulative cgroup CPU
and throttling. Report measured denominator and period allowance; a VM with fewer
than two CPUs cannot establish quota-under-demand proof. Memory: touch at most
768MiB in bounded increments, require cgroup OOM evidence rather than a generic
137 exit. PIDs: at most160 small sleep children, require EAGAIN plus cgroup PID
limit events, then reap every owned original. Descendants: ignored TERM within an
owned PID namespace, bounded stop escalation and checked stopped/removed state.

Each case has a 60-second result deadline and at most64KiB captured output;
no late reply grants a pass. Original CLI calls remain bounded to60s and cleanup
can outlive the result deadline; an owner descriptor is saved before any container.
outer packet600s, at most four containers, no host disk filling or global mutation.
Always attempt independent cleanup; uncertain cleanup cannot produce a pass.
These kernel probes do not substitute for Q02's agent/ledger causality or Q03/Q04.

Each worker reads VM-scoped `/proc/meminfo` before its fault and requires at least
1.5GiB available headroom. This is a qualification safety precondition, not a
minimum installation tier or an inference from Docker VM total memory.
