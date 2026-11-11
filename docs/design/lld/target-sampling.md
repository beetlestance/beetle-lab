# Bounded target runtime observations

Status: accepted implementation contract for the first optional HTTP sampler.
Owner: k6 wrapper; source values are target-reported observations, never cgroup
measurements or proof of resource enforcement. No public endpoint override or
credentials are inferred from the host. Full target charts/report heuristics remain separate.

## Configuration and scope

Suite config optionally carries targetSampling {path, intervalMs, timeoutMs,
cooldownMs}. Path is a safe relative path under the already compiled suite target;
redirects are rejected. intervalMs is1000..60000, timeoutMs is100..5000 and no
larger than intervalMs, cooldownMs is0..60000. No configurable headers or secrets.
The compiler rejects invalid paths/query/fragment and timing combinations.
The first sample precedes native execution; sampling continues during execution.
After the native process exits, the wrapper waits the configured cooldown while
still in the execute phase, then ends sampling before collection. The admitted
overall deadline still applies. Cancellation aborts and drains the original fetch;
no polling continues during seal or after attempt disposal.

## Component boundary

Public wrapper/target-sampling/index.ts exports startTargetSampling(options) and
its types. Options: target:string; config:TargetSamplingConfig; signal:AbortSignal;
optional fetch:typeof globalThis.fetch for deterministic tests. Config mirrors the
four fields above. startTargetSampling awaits one baseline attempt and returns an
owner with finish():Promise<TargetSamplingReport> and close():Promise<void>.
finish waits cooldown with sequential sampling, stops/drains and returns immutable
report. close skips remaining cooldown, aborts/drains all issued reads and timers.
Calls are idempotent; no nested ownership release on caller timeout alone.

One original HTTP request at a time, no queue or overlap. Use redirect:error,
credentials:omit and an abort timeout for fetch plus response stream consumption.
Read incrementally, at most65536 response bytes; cancel/drain oversized/error bodies.
Keep at most256 samples and at most1MiB of serialized report. Bound serialization
before retention. At capacity stop future sampling and explicitly mark limited;
never manufacture missing readings or zero values. Fixed keys only; no raw body,
URL, arbitrary labels, exception messages or headers in retained samples.

## Report

Report format beetle-target-runtime, version1, scope target-reported, samples,
limited:boolean, missed:number. Each sample carries observedAt UTC, phase
before/during/after, status ready/unavailable, reason null or fixed code
http/invalid_json/body_limit/timeout/transport/cancelled, and values with fixed
metric names and finite nonnegative number or null for absent/invalid values.
Source fields: heapAlloc,heapInuse,heapIdle,heapSys,heapReleased,heapObjects,
stackInuse,rss,external,arrayBuffers,totalHeapSize,usedHeapSize,heapSizeLimit,
mallocedMemory,peakMallocedMemory,goroutines,activeRequests,numCPU,totalMemory,
freeMemory,uptime,cpuPercent,systemCpuPercent,uvThreadpoolSize; nested cppHeap
allocated_size/used_size; eventLoopDelay mean/p90/p99/max; gc count/duration.
Keep source field names (nested names flattened with dots), not misleading unit
conversions. Missing source timestamp and unsupported fields remain unknown.
phase before is a point observation, not a qualified steady-state baseline.

The wrapper publishes target-runtime.json as a target-runtime artifact alongside
existing summary/numeric/history artifacts. Retained report<=1MiB is carved from
the existing admitted output/collection allowance; final byte accounting includes
it. Collector failure leaves unavailable observations and does not change test
assertions. Artifact custody/write/seal failure remains an execution failure.
The initial browser exposes the verified artifact through existing downloads;
no target values are relabeled as engine-resource measurements.

## Acceptance

Synthetic local responses cover known/missing/invalid values, nested fields,
non-2xx, malformed JSON, redirects, oversized/chunked/hung bodies, timeout,
cancellation during fetch/read, original drain and idempotent finish/close.
Fake clocks/timers establish one original, bounded rate, cooldown and capacity.
Runtime integration covers cancellation, output accounting, manifest/artifact
identity and actual local data from a consenting local target. No private service
paths, response content or credentials enter public fixtures or documentation.
