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
failed its V1 fresh-frame-span gate; quota replay records a reproduced mechanism.
Later ARM V2 sustained-stream and separately recovered final-read proofs now pass
their scoped gates; the original full trial remains failed at its collector, and
post-idle growth remained open after that ARM proof. A subsequent complete AMD long trial passed the streaming/drain gates; see the scoped update below.
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
[ARM native request/data conformance](../verification/native-request-data.md) adds
five methods, immutable bodies, CSV/JSON/inline/range coherence, all ten assertion
operators and readiness retry; secrets and other-platform matrices remain open.

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

[Native ARM secret resolution](../verification/native-secrets.md) now passes exact
environment/mounted delivery, unbound workspace/no-engine and rebound comparison,
with sixteen artifact canary audits and stock-pool accounting. Broader leakage
and other-platform matrices remain separate.

[AMD finite conformance](../verification/native-source-conformance.md) now passes
executor/discovery, threshold/failure, rich requests/data and shared/isolated
admission profiles. Earlier AMD long trials failed before performance work in advanced provisioning.
The later complete streaming/drain pass and separate latency miss are linked below.

[Short native ARM process RSS](../verification/control-process-rss.md) now has
separate process-level evidence under service ceilings, with three readers and
API p95 gates. A subsequent AMD short RSS pass is recorded in the same evidence; retained growth and telemetry comparison stay open.

[Native ARM target-reported observations](../verification/native-target-runtime.md)
now verify all32 fixed fields, zero/null mapping, before/during/after and advisory
HTTP/JSON misses through a hash-bound artifact. Browser/sensor/platform variants
remain separate.

The [complete AMD V2 long profile](../verification/long-stream.md) now passes
stream/final/post-idle/cleanup gates with1830physical work and eight verified
artifacts. Live p95293.49ms misses the separate250ms Q04 target. RSS-only AMD
trial43810739084 failed116.735s with independent cleanup; its first closed
projection lacked usable failure facts. Preserve that failure while improving
fixed diagnostic projection; do not infer an RSS or latency cause yet.

The targeted AMD RSS retry43814984061 passed with both cleanup checks; its closed
report records8/28/8points per service and API p9512.94/138.76/11.79ms. This closes
the short both-native RSS observation scope, not repeated growth or telemetry cost.
[Used workspace retirement](../verification/workspace-retirement.md) corrects the
user-approved F02 restriction locally; batch new candidate qualification remains.

[Finite repeated cardinality](../verification/bounded-repeated-load.md) now passes
four sequential ARM runs/1600physical requests with1487query values but19metric
series/run,32hashed artifacts, bounded RSS and four original allocation rows.
This is not flood/slow-reader/cancel, aggregate custody or a leak-free plateau.

[Cold repeated-fixture accounting](../verification/cold-repeated-accounting.md)
reconciles current backend debt and agent retained holds against the stopped
four-run data and32published/native artifact copies; no workload rerun. Full
active/delete/general accounting and memory-plateau acceptance remain separate.

[System-stop classification](../verification/system-stop-classification.md) fixes a
real defect exposed by metric-pressure qualification: remote stop intent could
become public user cancellation. The failed trial remains failed; output/slow-reader
qualification and a new schema29 packaged candidate remain open.

[Bounded ARM pressure and stalled-reader cancellation](../verification/flood-slow-cancellation.md)
now pass independently: actual output_limit at4MiB, and a real held content writer
with capacity refusal,7ms cancel ACK/1.11s physical stop and unchanged oldartifact.
This does not close repeated memory growth, telemetry overhead or the AMD latency miss.
