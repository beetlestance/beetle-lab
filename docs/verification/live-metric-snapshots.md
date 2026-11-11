# Shared live metric snapshot evidence

Status: locally verified live components; runtime integration remains pending.
Candidateee62fa5 integrated374d142. Independent source review found no blockers.
Frame<=64KiB binds attempt scope/epoch/subset digest and one real source-second
window. Selection<=20, exact identities/ordinals, coalescing counters, sparse values,
gauge timestamps and reused ratio/percentile semantics are checked. Upstream
coverage remains unknown; a digest is not approved-profile authorization.

Initial27 scoped cases (19codec+8history) passed4.38s. Added zero-rate case passed;
negative trend fixture first tried mutating a frozen estimate, then used a cloned
invalid value. Two added/fixed cases passed1.62s; a test callback exceeding complexity
was split, and its10 affected cases passed1.69s. The22 codec cases have passing
coverage across these scoped runs. Final lint0, Node types0, generated drift45
outputs0 and architecture1738files0. No full suite, Docker/native build or workload.

Identity helper accepts descriptors without totals; full-series callers remain
compatible. Descriptor/value calculation bodies reuse the reviewed historical
implementation; app fixed-error mapping remains unchanged. Private reports and
Git bundles are hash-verified under the completed live-contract cleanup archive.

## Publisher core

`engines/k6/wrapper/live` now supplies the fixed publisher interface. It uses shared
projection and frame capture, retains one latest slot plus one write original,
enforces monotonic cadence/deadline and charges whole buffers before write.
Stop discards pending data and waits for actual write/close originals. Failed
cleanup remains explicitly unconfirmed; advisory errors cannot change verdicts.

Nineteen focused cases cover projection parity, sparse/missing data, source gaps,
coalescing before/during writes, mutation isolation, cadence, invalid windows,
quota/clock/deadline failures, aborted startup, original drainage, reentrant close,
cleanup failure and invalid options. Initial eighteen cases passed; lint findings
were corrected. Independent review identified a publication-ordinal race between
success and cleanup reactions; a decisive regression case and issued-count fix
passed the nine producer cases. Ten lifetime cases passed on unchanged source.
Scoped lint and Node types passed; missing worktree dependency links were corrected
without installing packages. No Docker/build/full-suite or native IO was run.

## Mailbox envelope and sink

The shared `live-mailbox` export and engine mailbox sink are locally verified,
independently reviewed components. Ten envelope cases cover canonical layout,
busy/corrupt/torn data, length/revision limits and digest failure. Five sink cases
cover ordered commits, input copying, one original, held write/close drainage,
full physical charges, truncation and partial-write bounds. Scoped lint/Node types
passed; worktree package links were corrected before the sink test run.

Review rejected the shared-root file adapter: checking an inode before a later
rename/unlink cannot prevent child replacement races. Its native root-anchor proof
did not cover that gap. The draft was not integrated. Decision013 records the
replacement: bounded private tmpfs and a fixed descriptor-only mailbox.
Native mailbox creation/admission are now separately verified below; transport and
runtime composition remain pending.

## Native mailbox and admission

Trusted installation-profile opt-in splits a private128KiB/four-inode tmpfs from
the existing temporary allowance, preserving memory/swap, output binds and default
profiles. Twenty-two scoped admission/preparation cases passed; final changed-file
lint/Node types passed. A read-only independent review found no blocking issue.

A cached-image Linux arm64 proof ran as UID10001 with all capabilities dropped,
no network, read-only root, bounded CPU/RAM/PIDs and private tmpfs. The actual native
opener checked tmpfs size/inode limits and created the fixed file through a pinned
directory. It published two committed frames, rejected a sparse oversized extent
before materialisation, enforced the inode cap and confirmed original close.
Source: `engines/k6/wrapper/live-mailbox/native-proof.ts`; tiny esbuild proof bundle,
no image build/pull or service changes. The ephemeral container was removed.
This proves this arm64 component scenario, not amd64 or live runtime integration.

Caller obligations remain: approved subset and expected scope/epoch/journal binding,
cross-frame ordering/freshness, bounded physical IO/accounting/cleanup, private and
public routes, browser polling and measured overhead. The engine publisher core
is implemented only as a component; physical adapter/accounting and consumers are
next. See [contract](../design/lld/live-metric-snapshots.md).

## Bounded Docker archive reader

The raw transport accepts a fixed container ID/path and captures one regular TAR
entry without extraction. Limits are96KiB,256 chunks, bounded PAX metadata and
five seconds. At most two telemetry reads share ordinary capacity while preserving
control slots. Cancellation/deadline request destruction does not release a slot
until both physical HTTP originals close. No queue or retries are introduced.

Sixteen parser cases, seven reader cases, one qualification-boundary case and
21 unchanged transport cases passed across scoped runs. Lint findings were fixed;
final lint and Node types passed. Independent read-only review found no blockers.
Failures remain in private check-runner evidence; no full suite or image build ran.

The initial container-local tmpfs probe returned404: Docker documents that archive
cannot copy that mount type. A local-driver tmpfs volume with the same128KiB/four
inode limits passed the actual native producer, envelope/hash and bounded archive
read. The cached-image Linux arm64 fixture used UID10001, no network, dropped
capabilities, read-only root and CPU/RAM/PID limits. A stopped-fixture read returned
404; this does not independently measure memory reclamation. Guarded fixture
container/volume cleanup passed. No amd64 qualification is claimed.

Sources: `tools/qualification/native-application/mailbox-{producer,archive}.ts`.
The existing admission flag still describes the earlier container-local prototype;
it is not runtime-enabled. Exact local-driver volume ownership/options, active-plan
authorization, read drainage and lifecycle cleanup must precede enablement.
