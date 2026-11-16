# Native target-reported observation parity

Verified sourceb48936d8, native Linux ARM64, Node24.22.3. Trial passed39.212s;
normal and independent cold cleanup returned0. Frozen source hashes match.
Private evidence: `.agent-work/native-target-runtime`, plan, report and hashes.

One synthetic target and one packaged attempt used the stock1CPU/512MiB/PID128,
64MiB output and installation gates.40work requests passed,1readiness request,
8physical runtime-sampling requests,0unexpected paths. The sampler used1000ms
interval/500ms timeout/3000ms cooldown with no configurable credentials or headers.

The API target-runtime descriptor was unique. Its5975 bytes matched SHA-256
`f2db36110fa160c7e05a6534cda0bdb78ebb9630165879d54456a1800e31bf6e` before shared
strict decoding. Recorded sample count equalled physical sampler requests.

| Observation | Accepted evidence |
| --- | --- |
| Scope | `target-reported`, distinct from engine resource observations/enforcement |
| Phases |1before point,4during,3after; timestamps nondecreasing |
| Known/zero | heapAlloc0, rss123456; nested cppHeap42/0, event-loop delay0/2/3/4, gc7/12.5 preserved |
| Unknown | Missing fields, negative external and string arrayBuffers became null, never zero |
| Advisory faults | One malformed JSON and oneHTTP503 produced unavailable samples, fixed reasons invalid_json/http, all-null values and missed2 |
| Outcome | Work assertions still passed; limited=false; sampler misses were not invented HTTP workload failures |
| Privacy/sensors | Extra private marker and temperature keys were absent; no unsupported thermal state was fabricated |

All32 fixed metric fields were checked on every ready sample. This proves the
configured source-field mapping and unknown handling for this fixture, not target
sensor accuracy. The before point is not a steady-state baseline. Two focused
schema/oracle cases and types/lint/architecture/docs passed with independent
source review. Artifact facts were retained before verdict assertions.

[Actual browser comparison/rows/reload acceptance](browser-target-runtime.md) now passes its explicit manual-read flow; automatic initial availability and download variants remain. Remaining: native
AMD64 target sampling, wider timeout/body-limit/retention/cancellation variants.
Existing component evidence covers those boundaries locally; this trial does not
requalify every variant or close all F31–F33/A08/V24 claims.
