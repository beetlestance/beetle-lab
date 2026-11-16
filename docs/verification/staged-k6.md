# Staged k6 execution evidence

Date: 2026-11-08. Native and build source: `c527ce7`.
Environment: Node26.7.0, stock k6v2.2.0, macOS arm64.

## Reproduce

```sh
node --import tsx engines/k6/test/native-process/smoke-staged.ts /absolute/path/to/k6
npm run build:k6
```

The manual check owns its ephemeral loopback server and synthetic temporary files.
Input mounts are shaped read-only; no secrets or external targets are used. It
starts from staged Offer/manifest/bindings, then runs the production loader,
compiler, control journal, execution coordinator, builder, native stream/summary
collection, mapper, artifact custody, sealing and result-file publisher.
Only native process platform validation and binary/config paths use the explicit
private Darwin compatibility seam. Public installation remains Docker/Linux.

## Actual results

| Workload | Native exit/outcome | NDJSON records/bytes | Summary/numeric bytes | Journal bytes/events |
| --- | --- | --- | --- | --- |
| HTTP200 | 0 / passed | 48 / 9,030 | 7,655 / 3,338 | 4,969 / 11 |
| HTTP500 | 99 / failed | 48 / 9,032 | 7,708 / 3,338 | 4,970 / 11 |

Both cases made one readiness and one workload request. Required assertion counts
were exactly one passed or one failed, with zero unknown. Every original owner
reported confirmed quiescence. All five declared phases appeared once. The two
fixed artifact names had matching raw hashes/lengths; published content-seal
verification and journal replay matched the original result/events. The result
file already existed and matched its payload when engine.result was notified.

The engine build emitted a 1.09 MB Node24-targeted wrapper. Exact runtime/plan
sources accompany it; esbuild remains an external pinned platform dependency.
An actual stale-output probe refused an unexpected runtime source before building
and preserved it. A built-CLI probe rejected Darwin with the fixed profile error;
that rejection is not evidence of Linux execution.

## Review and limits

Independent reviews accepted both staged corrections: heartbeat stop/cancellation
cannot rearm stale work or escape synchronously; phase output limits apply before
native build/numeric writes. Forty-eight focused tests and all three TypeScript
projects passed. Independent actual-filesystem probes confirmed exact collect
allowance and one-byte-short rejection before numeric creation.

An initial integrated gate at c527ce7 stopped on a TypeScript inference error in
the smoke's artifact-buffer local. fe66003 adds its explicit Buffer annotation;
this has no separate native rerun claim. At clean fe66003, the integrated gate
then exited 0: 2,011 tests/166 files, all three TypeScript projects, lint, generation
37/23/6, architecture569 and docs81. The frontend 611.56 kB/178.59 kB gzip
chunk warning remains.

No Docker image was built or published. This does not establish Linux controls,
Node24 runtime, amd64 operation, power-loss behavior, agent transport/recovery,
application finalization, durable live-window history or complete product behavior.
