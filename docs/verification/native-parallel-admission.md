# Native shared and isolated admission

Scope: native Linux ARM64/Docker Desktop, qualified23bb8c82 source images and
Node24.22.3 observer. The archive/config/OCI-manifest identities are verified before
Compose effects. No image build, registry change or user installation is involved.
This is a synthetic correctness trial, not a performance-isolation benchmark.

## Declared budgets

Use the shipped pool:2CPU,1GiB memory,256PIDs, concurrency2 and128MiB output.
Each original requests1CPU/512MiB/PID128/64MiB output. Fixed control reserve remains
1350CPU milliseconds/603,979,776bytes/160PIDs; headroom is unchanged. Two retained
runs fill the output reservation pool, so every profile gets a fresh installation.
Do not delete retained history or enlarge pools to admit a third execution.

Each of two organisations owns its own workspace/suite/revision/run. Work is one
VU/40iterations with500ms waits, one readiness request and a distinct known target
route. Third queued work has the same finite config but must never execute.
The target is bounded512total/128per route with a loopback-only observer port.
The600s outer supervisor uses bounded public polls and an explicit1024-request
fixture session; cookie/CSRF/origin guards remain unchanged. Parallel mode explicitly
sets preferIdle=false; this is no claim of available thermal or idle sensors.

## Recorded results

| Profile | Result | Observation |
| --- | --- | --- |
| Shared two organisations + overflow | Passed56.577s | Both originals active with10/8 physical work requests observed. A third organisation stayed queued through four250ms observations with no original/target work, then cancelled. Both originals finished passed with40requests each, ready2/unexpected0/overflow0. Client298requests. |
| Isolated original then another organisation | Passed79.095s | Second stayed queued with no original/work; its native start followed first stop by3288ms. Both passed with40requests each, ready2/unexpected0. Client259requests. |

Every active original is bound to exact installation/attempt/generation/image.
Native inspection checks requested CPU/memory/PID caps, stopped state and no OOM.
Shared observations reject more than two live owned attempt containers. Isolated
completion additionally compares second native StartedAt against first FinishedAt.
Readiness is exactly once per executed run; queued cancellation cannot add work.
Both profiles passed normal and independent exact-owner cleanup.

The first shared trial failed58.800s on a settlement API transport error after
simultaneous execution and queued cancellation had passed; both cleanups passed.
The qualifier's256-request session was statically insufficient for its paired
polling allowance. The corrected passing trial needed298 requests. The original
transport error's exact branch was not captured and remains unattributed.
An initial isolated trial failed83.353s: its second-run60s settlement polling
window began while the first isolated run still held admission. Both cleanups
passed. Read-only forensic copies show both runs ultimately passed with released
execution/event charges, but do not qualify that failed trial or native no-overlap.
The corrected isolated fixture waits for the first result before opening the
second unchanged60s polling window; shared polling remains concurrent. The outer
600s bound and all product request/resource/admission gates remain unchanged.

Independent review required paired original reads to join through allSettled before
propagating failure to teardown. A held-sibling regression verifies that custody;
request ordering also has a focused test. Types, lint, architecture and docs pass.
The [AMD finite profiles](native-source-conformance.md) subsequently passed shared/isolated cases on verifiedb48936d8 images. These cases do not close every offer-loss/crash/cancel race,
telemetry overhead, long/flood/repeated-growth or idle/thermal policy acceptance.
