# Assigned k6 live approval
Public k6LiveSubset and createK6LiveApproval; caller selects this trusted engine
policy after validating immutable configuration. Generic agents consume approval,
not a k6 compiler. This module is for Node wrapper/control services, NOT k6-native.
Reuse pure k6 catalogue; select <=20 eligible execute/engine descriptors, preferring
latency/errors/throughput/load before remaining rows. Prepare/control stay excluded;
all omitted series count explicitly. Subset/scope outputs are detached and frozen.
Assignment uses canonical scope/generation, original intent and exact runtime spec
digests with injected SHA256 and a v1 purpose. Format a custom assigned UUID;
golden epoch/subset vectors pin v1 behavior. No clock/random/IO or first-frame pinning.
Epoch is identity, not authentication. Durable fences allow one logical producer
per launch; any permitted replacement requires a new generation/launch identity.
Stager writes RuntimePlan.specDigest into the readonly StagedAttempt. Both sides
must use that field; image/manifest digests cannot substitute for runtime spec.
This does not activate profiles or provide actor/HTTP/browser wiring.
Checks: approval.test.ts and engine raw/compiled parity plus attempt publisher cases.
