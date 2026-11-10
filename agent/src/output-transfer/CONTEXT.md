# Private output transfer port

OutputSourceReader is the declared private service boundary for source envelopes
and declared artifact chunks. Implementation and executable wiring are pending.
It consumes Journal-owned source/closure and the collection file owner's range
entrypoint. It never runs engines, creates closure, publishes application results,
deletes source files or refunds retention. HTTP retains its own original credits.

Contract: docs/design/lld/output-transfer.md. Public value validation lives in
@beetle/contracts/output-source; root/checkpoint/runtime remain agent-private.
