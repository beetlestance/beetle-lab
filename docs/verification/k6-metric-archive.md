# Retained k6 metric windows

Status: locally verified at `df33dff`. Contract:
[metric archive](../design/lld/k6-metric-archive.md).

The staged wrapper now writes bounded metric-window data and byte-offset index
files, then publishes their sealed descriptors alongside summary/numeric evidence.
Numeric-final v3 binds the pair's IDs, count and bytes. Incomplete metric processing
leaves partial history unsealed and reports windowsRetained:false. Existing compiler,
aggregation distributions, native thresholds and result authority are unchanged.

History takes an explicit share of the existing Offer output allowance. Data frames
are at most1MiB, index records256 bytes, with65,536 windows and256MiB combined caps.
One record is in flight; writes and verification reads are at most64KiB. Footer room
is reserved before another frame. Hash/exact-EOF and root/file custody checks, native
sync/close and named post-close checks precede sealed descriptors. No file corpus
or final array is materialized in memory.

Existing collect timing is preserved. Earlier retained history counts in execute;
newly drained windows/final records count only in collect. Collect now reserves
1MiB summary,1MiB numeric and at least64KiB final-drain room before native load.
Insufficient budgets fail explicitly; no user ceiling is raised to obtain a pass.

## Evidence

An independent reviewer verified the frozen11-path production candidate `54d2037`
and found no concrete blocker. Subsequent changes add a test-only multiwindow
oracle and fixture; reviewed production remained identical. Review used inherited
model routing after a named worker request failed; no named-model claim is made.

Archive17 checks passed in2.68s, covering offsets/histograms/gaps, empty history,
quota/frame/count rejection, corruption, root/symlink changes, partial writes,
held writes/closes and close failure. Real retained history exceeds8MiB and seals
through streaming reads; this does not establish whole-heap/RSS or native overhead.
The65,536 counter test mocks storage only; the Unicode fixture tests codec byte
positions, not suite catalogue acceptance. These are separate from native-file proof.

Affected composition/budget24 checks passed in4.28s; lifecycle/artifact/phase24 in4.85s.
These overlap earlier archive-focused runs. Private version/retention expectations
and the old1MiB collect admission case were updated for the new reservation policy;
existing standalone numeric exact/+1 IO checks remain intact. No gate was lowered.
Final lint/Node types passed. The new staged multiwindow oracle passed in1.28s.

Coordinator's one integrated composition file passed all6 checks in1.66s, including
execute/collect byte attribution, result seal, artifact bytes/SHA and native99 semantics.
Architecture checked1659 source files; docs checked269 before this report. Local
source hashes, review, failures and command evidence are retained; earlier raw tool
outputs are in the working session, with the final composition log also captured.

Actual k6/Docker execution, ENOSPC, direct truncation injection, platform/overhead,
CI and release qualification remain pending. This implements sealed history;
live prefix transport, bounded sample API/downsampling and browser charts are next.
