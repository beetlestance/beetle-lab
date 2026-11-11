# Shared live metric snapshot evidence

Status: locally verified shared contract, not a user-visible live feature.
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

Caller obligations remain: approved subset and expected scope/epoch/journal binding,
cross-frame ordering/freshness, bounded physical IO/accounting/cleanup, private and
public routes, browser polling and measured overhead. The engine publisher core
is the next packet. See [contract](../design/lld/live-metric-snapshots.md).
