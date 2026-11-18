# Target sampling

Public entrypoint: `startTargetSampling` and exported types in `index.ts`.
Input is a compiler-validated target and optional sampling configuration.
Sampling paths append under the target prefix; scheme-looking path segments cannot
change the request origin. Redirects are refused.
Effects: one original fetch/body at a time; baseline before return, interval
observations, cooldown observations through finish, original drain through close.
Report contains only fixed numeric keys and fixed status/reason codes; absent or
invalid readings are null. `missed` counts unavailable attempts and any retention
refusal. At 256 retained observations the sampler stops and marks limited.
Reads are capped at 64 KiB, retention at 256 observations and 1 MiB serialized.
Abort/timeout cancel the original request and reader; lifecycle completion waits
for their settlement, even if the injected transport delays abort completion.
Reports/samples/values are frozen. No process result or artifact ownership here.
Optional per-metric units are validated, detached and frozen before sampling;
their encoded envelope bytes count against the same 1 MiB report ceiling.
An optional trusted record callback runs serially before retaining each sample.
There is no callback queue; start, finish and close await the actual original.
A failed recording stops sampling and propagates; abort does not detach its work.
Spec: `docs/system/contracts/results.md`.
Cleanup rejection propagates through finish/close; advisory observations require
confirmed original cleanup.
Focused check: `node node_modules/vitest/vitest.mjs run engines/k6/wrapper/target-sampling`.
recent(limit) returns frozen newest retained samples for the live publisher (no IO).
Observation time uses the injected attempt wall clock shared with live frames.
