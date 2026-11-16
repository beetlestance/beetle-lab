# Local suite authoring evidence

Verified source: `c95f6c9` on `rewrite/integration`, 2026-11-09.
Scope: actual persisted suite authoring and immutable revision history through the
new backend and frontend. Input-byte publication and run submission are subsequent
work; this is not complete R0-R4 qualification.

## Behavior and review

The [suite contract](../design/lld/suite-authoring.md) is implemented through
generated clients, paired Fastify routes and the sole SQLite worker. Workspace
ownership, folder membership, optimistic versions, shared receipt identities,
immutable revisions and published input pins are checked transactionally.
Revision preflight validates structure; it does not claim successful execution.

Independent contract, backend and frontend reviews found and cleared SQL REPLACE
immutability bypass, truncated large worker replies, partial-JSON draft loss,
aggregate config overflow and editor unmount after failed background refreshes.
Permanent regressions preserve these cases. Additional independent probes covered
replacement with recursive triggers disabled and unknown-write replay through
organisation/workspace refresh failures. Source hashes were compared at integration;
later specification differences clarify backend limits and the test resource policy.

The React editor preserves complete form/JSON drafts, historical revisions and
identical requests after ambiguous writes. Cached verified data retains the editor
when refresh fails; a saved acknowledgement does not claim refresh completion.
No browser rendering or manual keyboard/reduced-motion acceptance is claimed.

## Executed checks

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0 at the source above:

- Generation checks matched37 runner,27 API and6 k6 outputs.
- All three TypeScript projects, lint and architecture checks passed;773 sources.
- Documentation check passed for128 files before adding this report.
- Frontend production build passed. Main chunk621.27kB/179.63kB gzip retains Vite's
  size warning; lazy suite chunk45.85kB/9.08kB gzip. Browser performance is unmeasured.
- All2,577 tests passed across227 files in307.17s, with one file worker.

The [functional resource policy](../engineering.md#functional-test-resources)
preserves assertions, isolation, test/hook deadlines and explicit within-test
concurrency. Four earlier two-worker gates failed with changing staging/deadline
failures (6,3,1,3 failures respectively); these remain failures, not acceptance.
An unchanged-source one-worker comparison passed2,575 tests in265.73s before the
two refresh regressions were added. Nominal filesystem fixture headroom was
explicitly calibrated and independently reviewed; short-budget rejection cases
remain. None of this establishes parallel engine stress or a latency guarantee.

The compiled backend smoke at `2a37626` passed real owned-loopback pairing,
organisation/workspace/suite creation, an exact1MiB UTF8 config save/read,
original receipt replay after later edits, config-free history summaries,
logout and clean SIGTERM. The production backend has not changed since that smoke.
Environment: macOS arm64, Node26.7.0; application Node24/image qualification remains.

## Remaining boundaries

Dataset pins require published metadata; this slice exposes no fake upload writer.
Implement verified file publication before dataset-backed authoring is usable.
The newer [storage intake evidence](storage-intake.md) verifies separate config/Offer
bounds through the actual loader/compiler; the authoring smoke did not execute a run.
Run/outbox, artifact transfer/finalization, live results, reports/comparison/export,
Compose, native architecture matrix and release qualification remain required.
The [native agent report](native-agent-k6.md) covers its separate real Docker tests.
