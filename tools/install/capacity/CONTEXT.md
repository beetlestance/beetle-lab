# Offline installed-capacity change

`policy.ts` derives a detached grow-only request from current persisted settings
and the committed provision request. It changes per-run/default memory and catalogue
versions for memory changes. Existing engine manifests, memory pool, control reserve, headroom, secrets,
retention and history are preserved. A requested limit above the installed pool
is refused; physical machine capacity is not inferred.

`index.ts` composes the existing cold-source leases/proofs, settings owner and
`state.ts` atomic selector publication. Baseline request/files remain unchanged.
A pending selector retains expected settings, UUID, kind/amount and proposed generation;
matching replay resolves an old or exactly committed CAS without duplicate writes.
Serving loaders recheck selector custody under their original startup leases.
No startup bypass, host-capacity inference or historical identity rewrite is allowed.
Contract: docs/system/contracts/resources.md.
Focused checks: tools/install/test/capacity-policy.test.ts.

Output-pool changes share the coordinator and settings CAS. They grow only aggregate
output within existing storage/reserve; per-run budgets stay fixed. Generation
digests bind kind/amount to prevent cross-resource replay. Old memory pending
records resume without replacing their proposed generation. Both CLI adapters use
capacity/arguments.ts; the Compose bundle is compose-capacity.js.
