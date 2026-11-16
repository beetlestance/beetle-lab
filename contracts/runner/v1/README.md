# Runner protocol 1.0

This directory owns strict JSON Schema 2020-12 sources. See
[the public entrypoint and commands](../../README.md) and the
[generated HTTP reference](../../src/generated/reference.md).

All IDs are opaque UUIDs. Digests are lowercase SHA-256 hex; image identities use
`sha256:` plus that digest. Counters and byte/time budgets are safe integers;
reservations are positive. Inputs, artifacts, capabilities, events and issues have
explicit collection limits. Offer configuration is an object with at most 256
properties and 128-character property names. Its contents remain engine-owned
unknown JSON; the installed config schema must validate it before admission.
Transport byte/depth/node limits also apply. This is not k6 configuration validation.

Offers, snapshots, cancellation, ACKs, event batches and results carry organization
and workspace IDs. Capabilities describe the installation-wide pool and are the
explicit unscoped exception. A sealed artifact reference inherits attempt ownership
from its containing result/event. It exposes an opaque artifact ID, relative output
path, size, digest and seal time; no host/storage path or mount option is accepted.
Relative paths exclude absolute paths, dot segments, backslashes and URL encoding.
The artifact owner still checks containment/symlinks and durable verification.

`ControlEvent` is wrapper-only and retains its own `seq`. `AgentEvent` has the
authoritative `seq`, a distinct source, and `wrapperSeq` only for wrapper events.
Each event kind has its own payload shape. Wrappers cannot emit supervisor-only
resource summaries, exit observations or admission evidence. `EventBatch` closes
its composed object with the dialect-specific `unevaluatedProperties` keyword.

A result always contains identity, execution observation, required assertion counts,
threshold evidence, completeness, sealed artifact refs and a terminal seal.
A passed ordinary result requires completed execution with a known integer exit,
complete evidence, zero failed/unknown required assertions and passing SLOs.
Discovery results name an expected abort rule. A passed discovery result requires
that rule to be reached and allows a failing threshold explicitly marked discovery;
unrelated SLO/required assertion failures still cannot pass. Exit zero alone is
never a result. An inconclusive result can seal partial/missing evidence.
The seal digest identifies the sealed evidence; schema validation cannot prove it.

Consumers own digest equality, required-capability support, budget comparisons,
generation/namespace matching, wrapper deduplication, event ordering/cursor gaps,
assertion count arithmetic, expected-abort rule matching, final outcome mapping,
supervisor exit proof and artifact verification. Structurally valid stale/replayed
messages remain valid shapes and must fail the appropriate state-machine check.
Generated TypeScript is an inference from the sources; runtime AJV2020 validation
is authoritative for constraints TypeScript cannot represent, including formats,
numeric limits and composed-object closure. Do not substitute typechecking for it.

The trusted installed manifest owns executable/argv, image/schema identities,
Docker backend, network profile, supported controls/capabilities and every phase's
work/time/output budget. Each of validate/prepare/execute/collect/seal occurs once.
There is no browser-supplied entrypoint, shell string, environment map, host path,
mount configuration or Docker flag. Secret references identify env/mounted versions;
secret values and their digests do not belong in protocol messages or diagnostics.

Cancellation records identity and generation; it is durable/idempotent at the
agent owner, with a repeated call returning the existing terminal snapshot after
closure. ACK confirms an application-durable cursor and never establishes test
success. The JSON client does not retry. Typed retry categories refer only to
transport/setup; a new execution always needs explicit new intent.

Shared definition modules separate the event envelope, wrapper/supervisor tagged
payloads, terminal evidence and execution observations. Public roots close these
compositions with `unevaluatedProperties`; each handwritten schema remains readable
and <=400 lines. The generator produces separate reference-expanded inference
projections, recorded with all owning source hashes in its manifest. These are
actual generated artifacts, used for type inference only; runtime validators and
HTTP consumers register the original frozen catalogue. Conformance vectors are
checked against both forms, and generated discriminants have static type checks.
