# Published artifact controls

Status: locally verified UI at `3841e18`, consuming the
[verified backend](run-artifact-downloads.md). Contract:
[artifact controls](../design/lld/run-artifact-controls.md).

RunDetail now shows publication loading, pending, absent, ready and failure states.
A single scoped attempt query retains only the current page, at most100 artifact
descriptors. Next replaces the page; refresh returns to the beginning. Pending
publication polls every two visible seconds; ready/absent/error stop polling.
Terminal refresh waits for an issued read. Retirement cancels/removes the exact
query and fences late scope, attempt and session replies.

Links use the shared five-UUID same-origin route and fixed attachment filenames.
Engine paths are text only. The browser owns transfer/save progress and cancellation;
the UI neither buffers content nor claims a click proves a completed saved file.
Already-issued browser transfers retain the backend's bounded download owner.

## Evidence

The implementer independently reviewed the contract; the coordinator independently
checked all11 source hashes, implementation, fixtures and failure oracles.
Generated-client UI tests cover page replacement, changed manifests, semantic
refusals, manual retry, pending/absent/empty-ready, held terminal reads, visibility,
identity retirement and late replies. A maximum-safe-integer byte descriptor
renders a download link without requesting or allocating its payload.

Focused artifact tests:29 passed in6.00s. Affected Run tests:128 passed in26.27s,
including those29; these counts overlap. Changed lint and web types passed.
Initial status assertions raced loading and the shared fixture exceeded complexity;
both were corrected without lowering assertions or gates. A shell wrapper failure
was retained and the affected check captured again with a valid exit variable.
Raw commands, results, logs and source hashes are retained in local task evidence.

Coordinator selected the actual RunDetail/generated-client composition test on
integrated source:1 passed in1.24s; other tests in that file were unselected.
Architecture checked1646 source files and docs checked263 pages before this report.
No full suite, build, Docker or repeated backend check was run for this UI change.

Real browser navigation/save behavior, viewport/focus appearance and independent
saved-file integrity are not established by jsdom. The synthetic click test prevents
unsupported jsdom navigation; it proves the UI creates no content fetch or invented
completion state, not that a browser saved the file.
