# Settlement local ownership evidence

[Settlement contract](../design/lld/output-settlement.md). This slice provides local
cleanup admission/drain; it does not implement SQL settlement, purge, refunds, runner
settlement HTTP or durable post-compaction replay. Existing native receipts remain
separate authority and original charges remain unchanged.

One cleanup-access gate is shared by the physical Journal.retirements identity,
bounded to64 original scopes,256 leases and2 settlement fences. Producer/runtime
retirement, the pipeline, inventory preparation/persistence, native removal and native
receipt acquire before foreign work, including their direct process entrypoints.
Known actual close/carrier completion releases leases; uncertain/rejected close keeps
them. A synchronous fence blocks new entries and drains existing originals before an
opaque owner/request-bound observation. The fence must remain through future SQL
settlement carrier completion. Its observation alone never establishes native absence.

Failed preflight, confirmation, runtime and inventory metadata now join actual failed
worker termination before release. Docker HTTP control requests retain their existing
bounded slot through actual request, response and socket close, including abort and
late responses. This closes the old destroy-plus-resolve gap used by never-started
runtime inspection. Inventory shutdown joins its whole quiescence/close/removal/lease
sequence, avoiding a false io failure from an earlier close-promise continuation.

Initial130cases/24files passed50.01s; types16.84s, lint7.71s, architecture12.91s,
docs.75s exited0. Review found the inventory shutdown scheduling race. Root also
corrected fenced pipeline errors to retryable429 capacity rather than400 protocol.
Affected42cases/10files passed32.64s; types16.52s, lint7.05s, architecture10.93s,
docs.39s exited0. Includes real compiled Journal held-termination, all direct cleanup
entrypoints, held native open, sticky rejected close, and authenticated TCP refusal.
Counts overlap. The first worker test incorrectly expected an invalid retirement
shape to terminate the worker; it timed out. Corrected unavailable-reply injection
uses bounded cleanup and passed. Both logs remain private evidence.

Actual task-owned Unix HTTP success and cancellation completed in39ms with request,
response and socket close observed before each transport promise completed. Exact
transport input hashes, script and JSON are retained privately. This used no Docker
or user service and does not qualify an image, engine run or platform release.

Independent review accepted the bounded lifecycle changes conditional on corrected
gates; those gates passed. Durable tombstone checks and actual transaction recovery
remain required before temporary fences may be released after compaction.
