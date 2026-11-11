# Target runtime report artifact
Public capture/decode/encodeTargetRuntimeReport and immutable report/sample/types.
JSONSchema runner/v1/target-runtime-report owns fixed names, bounds and statuses;
generated types supply engine and browser views. Do not duplicate metric-name lists.
Target-reported readings are not engine cgroup measurements or hard-control proof.
One report<=1MiB/256 samples, fixed32 metric keys; missing/invalid readings are null.
Unavailable sample requires fixed reason and all-null values; ready reason is null.
Missed counts unavailable attempts plus at most one retention refusal if limited.
Capture rejects getters/prototype tricks, unknown keys, invalid/nonfinite/negative
numbers, excess samples, malformed observations and contradictory status/reason.
Decode bounds raw bytes and uses fatal UTF8; immutable detached output owns values.
No baseline/leak assertion, unit conversion, target URL, headers or raw body here.
Checks: contracts/src/target-runtime/*.test.ts plus affected engine sampler cases.
