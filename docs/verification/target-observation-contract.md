# Target observation artifact contract

Status: locally verified shared boundary; target UI remains pending.

The runner schema owns the beetle-target-runtime v1 artifact: target-reported
scope, at most256 samples, fixed32 metric names, finite nonnegative numbers or
null, UTC observation timestamps and bounded phase/status/reason fields. Missing
values stay unknown. Unavailable samples have a fixed reason and all-null values;
ready samples have no reason. Missed counts unavailable observations plus at most
one refused observation when retention is limited. No engine-control claims.

Shared capture/decode/encode at @beetle/contracts/target-runtime detaches/freezes
reports, enforces1MiB raw/serialized bounds and fatal UTF8, and rejects unknown
fields/getters/prototypes. Generated schema types and metric keys replace the
engine's separate type/name list. Artifact publication validates the shared shape
before writing/sealing, with the existing output allowance and newline accounting.

Eight focused codec cases passed, including zero versus null, status/reason/missed
contradictions, numeric/key/count/byte/timestamp limits, ownership and round trip.
Twenty-one unchanged sampler/attempt cases passed. One initial test incorrectly
compared canonical JSON key order with schema order; fixed to compare key sets.
Changed lint and Node types passed. Independent read-only review found no blockers.
Initial schema reference/strictTypes and worktree export-link failures were fixed;
no checks or assertions were disabled. Generated/browser/structural checks accompany
integration. No image build, service restart or native workload was run.

Next: verified artifact read and scoped browser ownership, target plots, explicit
missing-data display and labelled baseline/final/cooldown heuristics. These are
observations; a before point is not a qualified steady baseline or leak verdict.
