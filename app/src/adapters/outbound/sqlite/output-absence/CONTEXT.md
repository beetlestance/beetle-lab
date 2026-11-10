# Source absence metadata

Public entrypoint: `index.ts` owns bounded read/adopt/finalize operations and RPC
captures; `values.ts` registers the deterministic native canonical proof validator
at schema initialization. `migration012.ts` installs sibling proof/receipt tables.
`operations.ts` is the effect-free RPC type entrypoint for the worker protocol;
it cannot import storage, schema or wire-capture implementations.
All ordinary requests and replies are capped at4096 bytes, proofs at2048.

Adoption matches the retained physical original and excludes source/manifest/slot
custody. Finalization replays its immutable receipt before checking current Run
version; otherwise it requires exact header end/admission, released execution,
contiguous full-ACK events and retained actual provisional result bytes.
The insertion trigger alone credits P-(C+R), projects an inconclusive terminal Run
and closes event discovery. Persisted cancellation wins; validation stays pending.
Older headers remain pending for an explicit runtime dispatch.observe refresh.
Native guards fence later writes; late full ACK is read-only across both families.
No remote IO, synthesized observation, engine retry, files or deletion occurs.

Focused command: `vitest run app/test/output-absence`.
