# Capacity source wire and backend cache evidence

Status: locally checked schema/producer/cache components. The latest full run has
one timing failure; this is not a green integrated or release gate.

## Exact source and behavior

Required runner wire/actual producer:
`815b666ad5b38c5be1b749ca76bb83b16591e40b`.
Private cache and independently reviewed ordering correction:
`15016c4d20d1d60dac6b520139fcd69a57f71051`.
Owning contract: [capacity observation](../design/lld/capacity-wire.md).

Capabilities retain one per-run Budget and require a separate total-pool/source
observation. The actual committed publisher supplies original timestamps/expiry,
configuration/installed-profile digest, provenance, guards and nullable sensors.
Repeated GETs cannot renew the original lease; overhead is subtracted once from
the total pool, before reservations. Backend storage remains a separate source.

The private SQLite RuntimeObservation requires absolute expiresAtMs. Ingress and
worker dequeue reject expired/future facts. The cache uses half-open source/age
leases, private frozen copies and scalar source/local-wall revocation fences.
Identical live replay cannot renew expiry. Unknown, rollback, out-of-order and
conflicting equal-time observations revoke; only a source newer than the fence
restores capacity. Malformed ingress preserves a currently valid observation.

Independent source reviews covered producer/schema and revised cache. Review found
an older-than-prior-fence delivery after recovery could leave recovered capacity
live; an executed regression failed before the check-order correction and passed
afterwards. Reviews establish source scrutiny, not runtime qualification.

## Commands and outcomes

At815b666, runner corpus/producer scope:403 tests in27 files passed. At the cache
candidate, storage/run scope:111 tests in20 files passed. Final corrected cache
scope: `npx vitest run app/test/storage/runtime-lease.test.ts
app/test/storage/runtime.test.ts app/test/storage/review-regressions.test.ts
--maxWorkers=1`:28 tests in3 files passed, exit0. Includes a real worker queue
advancing past source expiry while still inside the backend maximum age.

At15016c4, `NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` completed
with exit1:3,208 tests passed, one failed,319 files,448.26 seconds. The single
failure was the10-second deadline in the literal8MiB/128-chunk input test.
Its unchanged exact test then passed alone, exit0,5.86 seconds. No assertion,
input size or deadline was reduced. Timing stability in the full lane remains open.
An earlier sandboxed candidate run had16 loopback listenEPERM failures; those
listener cases passed after normal sandbox escalation in the revised full run.

The revised full run passed41 runner/35 API/6 k6 generated-output checks, all
three TypeScript targets, lint, architecture987, documentation156 and web build.
The existing609.69kB main-chunk warning remains.

At15016c4, `npm run build:api`, `build:agent`, `build:k6`, followed by
`smoke:api`, `smoke:agent` and `smoke:input-controls`, all exited0. Bundles target
Node24; local execution used Node26.7.0 on macOS arm64. Smokes used isolated
synthetic loopback/Unix fixtures and temporary data. The daemon was a fixture.

## Remaining proof

No new real Docker/native k6, amd64, image/Compose, supply-chain or release
qualification is established here. Actual private backend agent configuration,
HTTP/capacity polling, independently pinned backend disk evidence, durable dispatch,
ACK/projection, result/artifact finalization and browser run/results remain pending.
Enqueue and fresh capacity evidence cannot establish completed test execution.
