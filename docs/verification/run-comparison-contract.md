# Four-run comparison boundary

Status: reviewed contract and generated-client component. The separate
[backend slice](run-comparison-service.md) is locally verified; browser remains
pending. This packet itself implements no backend or browser behavior. Contract:
[bounded comparison](../design/lld/run-comparison.md).

compareRuns describes a stateless scoped POST with2..4 ordered terminal runs,
first baseline, optional metric selection and a262144-byte response ceiling.
The response retains authoritative Run/result summaries, bounded environment
fingerprints, explicit unknowns, baseline difference fields, at most100 config
pointer changes per peer and one selected metric/source per run. No configuration
values, secrets or corpus of metric history enters the response.

Semantic clients bind case-folded distinct IDs, route/body workspace, ordered
response identities, baseline/metric selection, logical binding shape, terminal
state, source/value/summary consistency, histogram/rate/gauge meanings and fixed
warning/difference policies. Existing metric semantic checks are reused. The
backend must still implement stable logical request/assertion matching through the
shared k6 layout, real pinned-source reconciliation and admitted lookup.

23 comparison-client cases passed, including exact256KiB valid JSON and a
one-byte-over transport refusal.79 existing route/scope/UUID cases passed; the
new descriptor-binding case passed after registering its request/reply fixtures.125 selected schema/projection/conformance cases
passed in the initial scope. Two existing inventory assumptions failed: a blanket
PageQuery fixture did not satisfy required seriesOrdinal, and the samples query
and existing live-snapshot fixtures were absent from the route coverage index.
The query test now uses actual registered fixtures; missing entries were added.
Only failed/changed cases were rerun, including the two newly registered vectors.
Generator drift, Node types, changed lint and structural/docs checks passed.

An initial optional-phase type error was corrected using the bounded canonical
encoder. One test wrongly combined passed outcome with partial completeness; it
now uses inconclusive evidence. Complexity checks caused responsibility-specific
identity/source/presentation helpers and table-driven negative cases. No threshold
or assertion was relaxed. No Docker, user services, storage mutation, native load,
backend route or actual browser qualification was part of this contract evidence.
