# Target sampling

Public entrypoint: `startTargetSampling` and exported types in `index.ts`.
Input is a compiler-validated target and optional sampling configuration.
Effects: one original fetch/body at a time; baseline before return, interval
observations, cooldown observations through finish, original drain through close.
Report contains only fixed numeric keys and fixed status/reason codes; absent or
invalid readings are null. `missed` counts unavailable attempts and any retention
refusal. At 256 retained observations the sampler stops and marks limited.
Reads are capped at 64 KiB, retention at 256 observations and 1 MiB serialized.
Abort/timeout cancel the original request and reader; lifecycle completion waits
for their settlement, even if the injected transport delays abort completion.
Reports/samples/values are frozen. No process result or artifact ownership here.
Spec: `docs/design/lld/target-sampling.md`.
Cleanup rejection propagates through finish/close; advisory observations require
confirmed original cleanup.
Focused check: `node node_modules/vitest/vitest.mjs run engines/k6/wrapper/target-sampling`.
