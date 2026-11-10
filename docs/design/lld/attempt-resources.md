# Per-attempt resource observations

Status: accepted implementation contract, before release qualification. Owns the
missing producer for resource.summary; [resources](resources-observability.md)
owns scope and budget policy. No per-function process CPU/RSS attribution.

## Reading and attribution

The Docker backend exposes sampleResources(plan, operation), a read-only bounded
operation on the existing transport. Resolve only an already-owned, inspected,
running runtime; verify plan identity and exact full container ID. Never accept a
browser-supplied name/path or adopt another container. Use the pinned Engine API
[stats endpoint](https://docs.docker.com/reference/api/engine/version/v1.47/)
with stream=false and one-shot=true. Read one bounded JSON reply through the
existing transport, not a streaming socket, Docker CLI or separate client.

ResourceReading contains nullable cpuMillis, memoryBytes and pids, plus reason
null/unavailable/unsupported/invalid/counter_reset. CPU is cumulative container
cpu_stats.cpu_usage.total_usage nanoseconds, converted to whole milliseconds;
validate the original counter as a nonnegative safe integer before conversion.
Memory is raw memory_stats.usage, not cache-subtracted working set. PIDs is
pids_stats.current. Reject unsafe, negative, malformed or wrong-ID replies.
Missing individual measurements are null, never zero. A failed read returns
unknown values/reason; it cannot revoke runtime ownership or invent termination.
Zero is valid only when actually observed. Keep the adapter's established original
request deadlines, cancellation and response bounds. No host/target CPU claims.

## Producer owner

A focused agent/telemetry owner retains one original read, latest coalesced sample,
counters and sampled maxima per active actor, at most64 actors. Sampling interval
is1s; journal publication interval5s, plus one final retained observation on runtime
exit. Share a two-original sampling admission across the supervisor; refuse excess
without a queue and count missed observations. A sample deadline is at most1s.
Never place stats IO in the create/start/kill/cancel critical path. Start sampling
only after a verified running observation, fence new sampling when stopped/retired,
and retain/drain issued originals. No detached timers after actor retirement.
The concrete installed factory supplies the backend reader; optional typing may
support focused old fixtures but must not silently disable installed telemetry.

Resource summaries have source docker-stats, lastSampleAt, samples, missedSamples
and reason. CPU is the last observed cumulative counter, not a sum of cumulative
samples. A counter decrease marks counter_reset; do not invent usage across reset.
Memory and PIDs are maxima of successful samples, explicitly sampled peaks, not
kernel lifetime peaks. No previous-process maxima/completeness are invented after
agent restart. Output bytes remain null unless independently observed; quota is
not output usage. Only verified CPU/memory/PID controls may be listed; timeout or
output controls require their own live guard evidence and are not inferred here.

Nullable scalar fields plus provenance are part of the shared resource.summary
payload. Update its real UI projection to show not reported and sampled peak labels,
including missed observations/reason; never render null as zero or imply continuous
coverage. These events are informational and never change Run/result verdicts.

## Durable event custody

Use the existing supervisor event producer and Journal source ordinals. Lifecycle
and resource events have one serialized ordinal owner, never independent cursor
reads followed by racing appends. Retain at most one exact issued resource event
and one newer coalesced observation; immutable issued intent replays after uncertain
append. Count coalesced/missed intervals. Lifecycle facts retain priority; telemetry
cannot form an unlimited pending queue. Known pre-issue busy may defer publication;
unknown append outcome must resolve/replay the exact original before advancing.
No new table, migration, private HTTP endpoint, ACK or event-delivery authority.

Runtime exit fences sampling before final summary and exit closure. Source closure
must include the producer barrier: no resource event may be appended after the
closed finalAgentSeq. Already-issued sample/journal originals remain owned during
cancel, retirement, source closure and application shutdown. Do not loosen existing
retirement checks. Unresponsive transport remains truthfully pending, not fake clean.
No successful engine/result may be inferred from sample or publication success.

## Acceptance

Use actual bounded Docker transport fixtures and Journal/actor/controller paths.
Cover exact ownership and wrong IDs, absent stats/cgroup variants, true zero,
unsafe counters, raw versus cache-adjusted memory, CPU reset, sampled maxima,
unknown/restart labels, two-original saturation, ignored abort/deadline and late
reads, reentrant close, coalescing and bounded failed publication, ordinal races
with lifecycle events, runtime exit and closed-source producer barriers. Show
cancel/kill can proceed while a stats original is held. Public event replay and
actual timeline must display emitted provenance without changing outcome.

Run affected telemetry/backend/supervisor/controller event controls, Node and web
types, changed lint and focused projection tests. Reuse unchanged suites. Coordinator
reviews source once and one changed composed Journal/event/UI boundary. No Docker
image/full-suite/soak claim from synthetic stats; native source/overhead/amd64+arm64
qualification remains required. No additional opinion agent absent a named blocker.
