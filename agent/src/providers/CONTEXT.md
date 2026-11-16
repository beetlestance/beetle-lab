# Installed provider boundary

Public types live in `types.ts`; `service.ts` implements scoped input and secret
resolution. `private-file.ts` owns bounded materialization for installation files
and mounted secrets. The public index is maintained by the composition owner.

`capture.ts` selects fixed own data descriptors without reading unrelated keys.
`root.ts` pins canonical ancestry and bigint metadata; `lease.ts` owns original
filesystem calls and the process-wide two-file capacity. `stream.ts` owns lazy,
single-consumer input lifetime and fixed 64KiB reads. Staging owns input hash
verification and publication; these adapters never write or delete input files.

Cancellation retains issued calls through original close. Failed close keeps its
lease and handle globally reachable forever; materialized reads remain pending
and service close reports cleanup failure. There is no reset or close retry.
Private fault ports are test seams; the public factory uses native filesystem I/O.

Contract: `docs/design/lld/installed-providers.md`.
Scoped check: `npx --no-install vitest run agent/test/providers --maxWorkers=1`.
