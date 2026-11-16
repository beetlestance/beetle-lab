# Native telemetry comparison

ARM64 component comparison passed against source images `b48936d8`: ten trials,
40,000 physical requests, ten readiness requests and no unexpected work. Four
measured pairs exclude the first off/on warm-ups and balance execution order.

| Measured pair | Off wall ms | On wall ms | Additional wall |
| --- | ---: | ---: | ---: |
| 1 | 13,281 | 13,352 | 0.53% |
| 2 | 13,315 | 13,153 | -1.22% |
| 3 | 12,803 | 13,179 | 2.94% |
| 4 | 13,101 | 13,156 | 0.42% |

Sum of paired on times divided by sum of paired off times gives **0.65%**
additional wall time against the unchanged5% target. Docker StartedAt/FinishedAt
provide wall times. This is one synthetic fixed-work fixture, not a general
performance guarantee or a backend HTTP benchmark.

## Boundary and evidence

The qualification-only agent assembly uses production supervision, journal,
admission, staging, resource/output guards, installation ownership and shutdown.
Its entrypoint retains the shipped UID1000 identity transition and PID1. It runs
with0.25CPU/256MiB/PID64. Each engine receives the same full1CPU/512MiB/PID128,
60-second and8MiB resource offer, volumes and reservations in both modes.

On enables actual resource sampling, engine live publication, agent decoding and
three readers. Off omits optional observation and live publication/consumption;
there is no installed off mode. Actual engine PID1 environment is checked in both
warm-ups. A common512KiB final artifact ceiling prevents the larger off-mode
artifact partition from explaining the work result. All ten trials verify eight
artifact hashes, complete4,000-request numeric counts and four required checks.

The same external observer collects agent CPU and process RSS in both modes.
Across the four measured trials per mode, arithmetic mean per-trial CPU usage was
23.96% off and24.11% on, expressed as percent of one logical CPU. Both are close
to the stock25% agent CPU allowance; this does not establish spare CPU capacity.
Maximum summed process RSS was141.15MiB off and141.58MiB on; summed RSS can count
shared pages more than once. Cgroup memory is a separate measurement. There were
139 observer points, with13–14 points per measured trial. These values do not
prove zero growth, absence of leaks or the cause of another latency result.

Unavailable live reads remain counted. Fresh frames were observed by every on
reader; uninterrupted availability is not claimed. Each verified stopped engine
and its exact owned live volume is removed between trials without force; this
fixture cleanup neither refunds storage reservations nor proves retention.

Native ARM trial completed in221.802s with normal and independent cleanup checks.
The closed local projection was validated against original reports. Private raw
reports and frozen input hashes remain outside public artifacts. Only a validated
field whitelist is eligible for CI upload. AMD qualification remains pending.

## Retained failures and reuse

Earlier ARM trials failed: two exercised the stock inlined entrypoint instead of
the intended assembly; one rejected an absolute executable token; one completed
all ten workloads but failed strict final-report serialization. None is promoted
to a whole-trial pass. Corrected packaging, catalog and report paths have focused
regressions. Final workflow/projection and report metadata edits do not change
the ARM5 measurement program; the accepted measurement inputs remain retained.

Q04 remains open for native AMD comparison and the separate long-stream latency
miss. [Repeated memory](repeated-memory-analysis.md) is an independent question.
