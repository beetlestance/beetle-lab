# Shared k6 live approval evidence

Status: locally verified policy/producer assignment; activation remains pending.

The existing pure catalogue rules were moved into the shared Node-free k6-metrics
contract; threshold checks stay in the compiler. Raw/compiled parity covers both
readiness modes. The wrapper now derives the same scope/spec/intent-bound assigned
UUID as a trusted caller; no first-frame approval or new handoff channel. Defaults
prioritize latency/errors/load under the same20-series limit. Golden vectors pin
assignment and selection. Profiles remain off; actor/HTTP wiring is next.

Scoped policy, attempt and runtime-build cases passed across changed scopes, with
lint/Node types. Native provenance initially rejected the moved dependency; exactly
one regular shared file is now admitted/counted under the unchanged2MiB source cap.
The emitted script still excludes Node/compiler/validator code and secret values.
Cached-image Linux arm64 k6 inspect then evaluated the real native init path in a
networkless UID10001/capdrop/read-only CPU/RAM/PID-bounded temporary container.
It did not execute target load or qualify amd64. An unsupported inspect CLI flag
was corrected; fixture cleanup passed. Native end-to-end wiring remains pending.

Sources: contracts/src/k6-{metrics,live}, engine plan/build/attempt integration and
engines/k6/test/runtime/native-policy-proof.ts. Native proof uses cached image
sha256:4c34348bd2772041a71a148b88cb4faf4f081d0d112fbb7f0b686afb0e5c7b38;
script23,015bytes, logical build peak25,094bytes. Scoped independent review found
no blockers. Golden/final structural checks accompany integration. No user services
or images were changed. Policy identities are not authentication; durable fencing
and trusted installed policy selection remain mandatory.
