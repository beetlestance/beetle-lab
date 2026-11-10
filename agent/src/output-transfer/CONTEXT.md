# Private output transfer port

createOutputSourceReader implements the private service boundary for source envelopes
and declared artifact chunks. Executable wiring and actual native composition are pending.
It consumes Journal-owned source/closure and the collection file owner's range
entrypoint. It never runs engines, creates closure, publishes application results,
deletes source files or refunds retention. HTTP retains its own original credits.
Two processwide service originals are reserved before foreign capture. Fresh bounded
request budgets never release issued Journal/range work on abort or expiry. The exact
range owner retains result/quiesced/cached-close custody before service settlement.
Public replies require the current physical Journal, source and complete closure
receipt; no private root/runtime/checkpoint escapes. Chunk selection rejects ambiguous
or differently spelled IDs and serializes only checked owned <=65536-byte ranges.
An absent source followed by a released/rejected snapshot is re-read once after
that terminal fact before unavailable is allowed. Existing-source and pending
paths add no query; source/closure proofs and request budget fences still apply.

Contract: docs/design/lld/output-transfer.md. Public value validation lives in
@beetle/contracts/output-source; root/checkpoint/runtime remain agent-private.
