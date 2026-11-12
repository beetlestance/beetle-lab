# Performance report artifacts

Status: reviewed local engine component and admitted publication composition.
Native Linux arm64 production-image/public-API publication also passed; inline
browser and release qualification remain pending.
Contract: [performance reports](../design/lld/performance-reports.md).

The existing mapper and shared numeric projection now produce plain-text reports
and metrics CSV. Outcome, assertion definitions, discovery, completeness, loss
counts, observed zeros, unknown absence, rate denominators, gauge source times and
histogram estimates/bounds retain their original meaning. CSV includes a summary
row when metrics are missing. No config, payload, header or secret is an input.

Seven renderer cases passed;49 affected attempt/publication cases passed after
corrections. Two additional custody cases passed: cancellation/overflow before
file opens and byte capture before asynchronous custody. Existing symlink-negative
proofs verify neither report can substitute a secret or gain a partial result.
Changed-file lint, Node types, architecture and documentation checks passed.

The first71-case scope passed47 and failed24. An accidental repeated insertion in
the attempt cleanup body was removed; an exact partition oracle was corrected by
one byte. Initial type failures were confined to mutable test fixture arrays.
A later test startup lacked permission to write the shared Vite cache; task-owned
cache/package links corrected that prerequisite. Failures remain retained with
scoped command logs; no assertion or gate was lowered.

Report generation/custody consumes an explicit512KiB reservation carved from total
and collect ceilings. Each output is capped at256KiB. Large reports fail explicitly
rather than truncate; the fixed report ceiling is a first-release limit. This
changes the minimum usable output partition and reduces build/history allowance.
Actual file lengths/hashes are part of the ordinary sealed artifact manifest.
Generic artifact download already carries the files; dedicated report names/MIME,
inline display and actual browser save remain dependent work.

A production engine build from de25c19 passed in3.00s, using the unchanged normal
Dockerfile plus the owned report source copy. The backend bundle took1.41s; a
single native public-API proof took20.05s. One VU made20 work requests plus one
readiness request, with no unexpected requests. Completion passed and all six
published artifact hashes/files were independently verified, including the4,668-byte
text report and5,446-byte CSV. Retained payload was88,732 bytes, refund16,688,484,
and charged storage154,268 including metadata. Task resources were cleaned.
This uses the existing agent image; no user service restart or repeated cancellation
lane was necessary for this report-only collect change. Native amd64, overhead,
crash/retention and actual browser display/save remain unqualified.
