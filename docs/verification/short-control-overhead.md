# Short packaged control observation

Status: scoped ARM64 short-window acceptance on Node24.22.3. The earlier Node26
diagnostics remain failed/target-missed. This is not30-minute soak, uninterrupted
reader availability, telemetry accuracy/on-off overhead or a machine tier.

## Source and environment

Native Linux ARM64 containers used candidate23bb8c82, whose source CI43756923411
passed all twelve gates. The qualified archive was115,389,921bytes, SHA256
`3bb63ef544bb9b97522d863ae8433786836c09cf152aa12905e38afa09439c4a`.
Docker Desktop29.9.3/Linux7.0.14-linuxkit/cgroup2 reported10vCPUs and
12,526,305,280RAM bytes. Nine other containers were running before the diagnostic
trial; their presence does not establish a contention cause. User services stayed
unchanged. Harness base5221cd31 and exact dirty hashes are retained privately.

All six image revisions/platforms were checked. Docker's containerd store returned
manifest IDs where the native builder had reported config digests. The verifier
hashes the archive and binds every loaded role to its exact verified config or
corresponding manifest, never just its label. The mapping is retained in evidence.
Stock UID/runtime ceilings, output pool and control reserve were preserved.

## Accepted short window

The unchanged workload/caps passed in71.434seconds on Node24.22.3, matching the
shipped runtime line. Private official binary/checksum verification is retained.
Exact ready1/work40/unexpected0 and owned cleanup passed; every sampled control
memory value remained below its configured ceiling. Independent review accepted
control latency and the descriptive sampled CPU/memory scope only.

| Window | Actual CPU sample span | Frontend CPU / peak memory | Backend CPU / peak memory | Agent CPU / peak memory |
| --- | --- | --- | --- | --- |
| Initial idle | 7.73s | 0.056% / 4.56MiB | 5.08% / 99.80MiB | 7.41% / 77.76MiB |
| Loaded observation | 30.23s | 0.119% / 4.71MiB | 17.24% / 105.14MiB | 16.83% / 87.20MiB |
| Post idle | 7.70s | 0.055% / 4.39MiB | 4.37% / 105.16MiB | 6.51% / 87.22MiB |

Settings p95 was6.84ms (16calls), loaded Run p955.83ms (55successful calls),
and post settings p955.43ms (16calls), with no failed control reads. All126live
attempts had p95100.30ms, **including95unavailable responses**. The31successful
live reads independently yield observed p95178.54ms. Readers saw9/5/5distinct
frames. These small samples establish neither an availability SLA nor continuous
three-reader service. No latency or resource target was increased.

Docker-reported image sizes are in the private result; shared layers and archive
compression mean they cannot be summed into installation disk requirements.
CPU percentages are descriptive one-core observations, not telemetry overhead or
an idle-target qualification. Repeated-run/post-idle growth remains unqualified.

## Recorded target miss

Retry2 completed in70.726seconds with exact ready1/work40/unexpected0, one VU and
500ms waits. It observed three authenticated readers and verified owned cleanup.
Every control-service memory sample stayed below its actual declared ceiling.
External read-only Docker stats avoided injecting Node probes into control peers.

| Window | Actual sampled CPU span | Frontend CPU / peak memory | Backend CPU / peak memory | Agent CPU / peak memory |
| --- | --- | --- | --- | --- |
| Initial idle | 5.54s | 0.028% / 4.58MiB | 5.08% / 99.58MiB | 7.28% / 79.67MiB |
| Loaded observation | 28.23s | 0.070% / 4.50MiB | 14.84% / 103.66MiB | 16.29% / 83.98MiB |
| Post idle | 7.32s | 0.053% / 4.11MiB | 7.50% / 103.45MiB | 7.05% / 84.60MiB |

CPU denominator is one core, derived from cumulative container CPU nanoseconds
and the actual monotonic sample span. Memory is Docker usage including charged
cache; separately recorded anonymous memory is not process RSS. The eight-second
observation loops do not make their first/last sample spans uniformly eight seconds.
Averages neither establish nor exclude queueing, IO or throttling causes.

| Route/window | Attempts | Successful | Failed | Nearest-rank p95 |
| --- | --- | --- | --- | --- |
| Initial settings | 6 | 6 | 0 | 2000ms |
| Loaded Run | 31 | 31 | 0 | 1339ms |
| Loaded live metrics | 72 | 18 | 54 HTTP503 | 86ms |
| Post settings | 9 | 9 | 0 | 1400ms |

All attempted call durations enter the aggregate and per-endpoint distributions.
For six/nine samples p95 is the maximum; these are short observations, not a
confidence interval. Every failed control read remains fatal regardless of p95.
Live unavailability is reported separately: the three readers observed9/3/2unique
frames, not uninterrupted streams. A short live-reader pass cannot imply zero
failed API reads or complete coverage. The250ms target was not raised.

## Preserved failures and next diagnosis

The first preflight failed before containers because it incorrectly equated a
local manifest ID with a config digest. That failure remains recorded. Retry1
failed during the initial idle settings read with the unchanged two-second client
deadline; owned cleanup passed, and its underlying cause remains unproven.
Retry2 retained partial samples, endpoint durations, status and failure counts and
confirmed the target miss above. No timeout increase or silent retry converted
those attempts to passing qualification.

Retry3 failed in65.949seconds because at least one reader did not observe two unique
frames. Cleanup passed. Its correlated calls show that slow settings/Run reads
were already delayed at fetch resolution (for example1480.5ms total versus
1479.6ms to headers); later SDK work was about1ms in those samples. Live503s
included `capacity_unavailable` and `storage_unavailable`. This narrows the
investigation but does not identify a server component, IO or scheduling cause.

The diagnostic correlates fetch resolution/header timing with whole
SDK-call duration and records closed live protocol codes. It returns the original
Response unchanged and retains neither cookies nor body data. Fetch resolution
includes connection/client scheduling; the remaining SDK interval includes body
transfer, preparation, decoding, validation and scheduling. Subtraction alone
cannot isolate backend time or prove a validation cause.

The idle-only Worker round-trip diagnostic collected539completed spans in43.756s
with cleanup and no discarded records. Its33`getSettings` spans (including
background reads) had p951.4ms; they end before parent reply validation and do not
account for unfinished calls. A log-only proxy diagnostic then recorded2–7ms
Nginx spans for the final20settings responses while client calls remained slow.
Nginx defines its [request interval](https://nginx.org/en/docs/http/ngx_http_core_module.html#var_request_time)
from first client bytes; its [upstream timings](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#variables)
are separate measures. These instrumented trials locate measured intervals rather
than prove a universal server/IO/scheduling cause. They are not qualification.

Alternating same-API transport comparisons narrowed the environment effect:
Node26.7.0 global fetch varied4–1234ms while the shipped Node HTTP adapter took
3–12ms. Node24.22.3 ran both paths consistently around4–7ms. Static health probes
were also fast. This supports a client-runtime/transport-specific effect in this
Darwin/Docker Desktop setup; it does not establish a universal Node defect or the
cause of every earlier timeout. Matching runtime should precede server tuning.

The completed one-off Worker/proxy diagnostics and regression cases were moved
into the private frozen source snapshot. Retained measured qualifier dependencies
were hash-checked unchanged; no native repetition was needed for that retirement.

Private evidence: `.agent-work/short-control-arm/`, including frozen inputs,
check plans/results, native outcomes and original ownership/log roots. A full
latency pass,30-minute stream, flood/high-cardinality, repeated-growth/parallel,
telemetry comparison and disk/rollback cases remain separate acceptance work.

## Hosted observations atf075ea00

[CI43774155621](https://github.com/beetlestance/beetle-lab/actions/runs/43774155621)
reused the qualified23bb8c82 native archives, without builds or publication.
AMD64 passed the strict short-window projection and independent cleanup: control
settings p954.37ms/run4.83ms/post9.69ms; live99/129unavailable, successful-live
p95120.97ms, reader fresh-frame counts9/3/2. This is scoped control-latency proof,
not uninterrupted-reader availability. Runner:4CPU,16760344576bytes RAM,
Docker28.0.4/kernel7.0.0-1017-azure/cgroup2.

ARM64 failed after96.6s. The original success-only projection discarded its
failure details; cause remains unknown. The next harness retains only fixed
phase/source coordinates/counts/timings on failure and still exits unsuccessfully.
Overall CI remains failed; AMD success does not qualify ARM or the full R4 gate.
