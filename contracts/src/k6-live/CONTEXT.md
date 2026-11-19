# Assigned k6 live approval
Public k6LiveSubset and createK6LiveApproval; caller selects this trusted engine
policy after validating immutable configuration. Generic agents consume approval,
not a k6 compiler. This module is for Node wrapper/control services, NOT k6-native.
Reuse pure k6 catalogue; select <=20 eligible execute/engine descriptors: duration and
failed for the first K6_LIVE_ENDPOINT_ROWS (6) requests, then a virtual pooled check
rate when execute assertions exist, priority metrics and remaining rows. Prepare/control
stay excluded; excludedSeries counts only omitted native series. Subset/scope outputs are detached and frozen.
Assignment uses canonical scope/generation, original intent and exact runtime spec
digests with injected SHA256 and a v1 purpose. Format a custom assigned UUID;
golden epoch/subset vectors pin v1 behavior. No clock/random/IO or first-frame pinning.
Epoch is identity, not authentication. Durable fences allow one logical producer
per launch; any permitted replacement requires a new generation/launch identity.
Stager writes RuntimePlan.specDigest into the readonly StagedAttempt. Both sides
must use that field; image/manifest digests cannot substitute for runtime spec.
This does not activate profiles or provide actor/HTTP/browser wiring.
Checks: approval.test.ts and engine raw/compiled parity plus attempt publisher cases.

K6_LIVE_METRIC_IMAGE_ENV names the versioned trusted image marker shared by
packaging/install inspection. It is not a user configuration field or new wire DTO.
targetIntervalMs comes only from source.targetSampling (validated config), else null.

The internal k6 history checkpoint stores a complete metric prefix with an
optional approved target prefix. It uses two fixed names, canonical JSON and a
SHA-256 checksum, each bounded to 4 KiB. Decode independently binds the launch,
scope, subset and interval. The agent still needs to verify the referenced
files and physical stop before use.
