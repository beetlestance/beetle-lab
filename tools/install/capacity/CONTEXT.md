# Offline installed-memory change

`policy.ts` derives a detached grow-only request from current persisted settings
and the committed provision request. It changes per-run/default memory and catalogue
versions only. Existing engine manifests, pool, control reserve, headroom, secrets,
retention and history are preserved. A requested limit above the installed pool
is refused; physical machine capacity is not inferred.

`index.ts` composes the existing cold-source leases/proofs, settings owner and
`state.ts` atomic selector publication. Baseline request/files remain unchanged.
A pending selector retains the expected settings, UUID and proposed generation;
matching replay resolves an old or exactly committed CAS without duplicate writes.
Serving loaders recheck selector custody under their original startup leases.
No startup bypass, host-capacity inference or historical identity rewrite is allowed.
Contract: docs/design/lld/installed-memory-change.md.
Focused checks: tools/install/test/capacity-policy.test.ts.
