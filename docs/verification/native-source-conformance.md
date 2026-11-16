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

## Recorded AMD64 results

Run [43806565190](https://github.com/beetlestance/beetle-lab/actions/runs/43806565190),
harnessc3397cb4, verified sourceb48936d8: all six finite profiles passed. Times:
executor/discovery95.987s, thresholds94.817s, failures94.337s,
requests/data98.716s, shared admission105.609s, isolated admission127.997s.
Each private report passed source/platform/runtime/outcome projection. Aggregate
execution and independent cleanup both succeeded. The closed report is retained
in `.agent-work/amd64-conformance/finite-public1` and as the native CI artifact.

The long profile failed30.780s before sustained work. Its isolated retry,
[43807854664](https://github.com/beetlestance/beetle-lab/actions/runs/43807854664),
also failed in `advanced-provision`, with normal and independent cleanup passing.
Neither establishes long-run stability or a runtime/stream failure. Subsequent
harness diagnostics retain an allowlisted advanced substage and the installer
CLI's fixed error classification, never raw stderr. Installation deadlines and
performance acceptance targets remain unchanged while this cause is investigated.
`long-amd64` selects only this failed profile; completed finite cases are reused.

Adding a workflow alone is not acceptance evidence. Synthetic
cases do not establish general availability, process RSS, telemetry overhead,
all scheduler races or compatibility with future schemas.

The next diagnostic run43808805341 isolated failure to `write-request`, before
the advanced installer CLI. Code review found a detached-start gap: the qualifier
started the one-shot default setup with `up -d setup` and wrote immediately. The
corrected qualifier waits for that exact project/revision/image-bound original
to stop with exit0/OOMfalse before writing. Two focused guard cases pass; native
retry remains necessary. No permission is repaired or deadline extended. The old
write error's errno was not captured, so it is not retrospectively attributed.
