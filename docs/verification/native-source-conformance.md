# Native source conformance

The manual `ci.yml` source-archive mode now accepts `qualify_source_profile`:
`short-control` preserves the existing default; `missing-amd64` selects two
independent Linux AMD64 jobs on separate hosted runners.

Both jobs restore only native images from the supplied successful source CI run
and exact source revision. The existing stage verifies all12 source gates,
scans, immutable archive contents and isolated round-trip evidence. No images are
built, published or pulled from an unqualified mutable tag.

The finite job runs executor/discovery, threshold, assertion/transport,
request/input/assertion and shared/isolated admission cases. The long job runs
one actual30-minute active performance attempt with three independent readers,
29-minute fresh-frame spans, eight final artifact hashes and post-idle samples.
Each case owns a separate installation and synthetic target. One failed finite
case stops later cases; the independent cleanup enumerates every known case.

Only closed public reports are uploaded: exact source/harness revisions, image
IDs, native outcome/exit facts, bounded counts, timing and Docker memory facts.
Raw API bodies, configurations, exception text, paths and private logs remain
unpublished. Missing or malformed evidence produces a fixed failed marker.
Execution failure, dirty/wrong harness or failed independent cleanup prevents a
passing aggregate even if an individual private report claims success.

This change provides the execution path. Native results must be linked after
actual completion; adding a workflow alone is not acceptance evidence. Synthetic
cases do not establish general availability, process RSS, telemetry overhead,
all scheduler races or compatibility with future schemas.
