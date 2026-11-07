# Native k6 response memory

Status: implementation decision; engine/container qualification remains required.
Owner: k6 runtime and supervisor. Review date: 2026-11-07.

Existing body-substring and JSON assertions require response content. Stock k6
v2.2 buffers decoded text/binary responses before returning them to JavaScript.
Its request parameters expose response type and timeout, not a pre-buffer body
limit. [Request parameters](https://grafana.com/docs/k6/latest/javascript-api/k6-http/params/),
[upstream response reader](https://github.com/grafana/k6/blob/v2.2.0/lib/netext/httpext/compression.go).

Use discarded bodies by default and retain them only when assertions need them.
Our response-processing byte/node/depth limits apply after native buffering and
before additional JSON parsing. They must not be advertised as download limits.
Do not copy response bodies into logs, control events or default artifacts.

The supported product runs each engine under its declared hard RAM limit. A large
native buffer may cause that engine to fail; it cannot establish a passing test.
OOM classification requires runtime evidence, not exit137 alone. Qualification
must exercise large and compressed responses plus failure isolation. Native host
fixtures do not prove the container guarantee.

Keep native k6 transport semantics rather than inserting a new proxy or fork for
the first release. A proxy changes the measured path and adds another resource
owner. Remove this narrow exception when an upstream pre-buffer limit or a
qualified bounded transport can preserve the required HTTP measurement semantics.
Export documentation must state external memory-control requirements explicitly.

This is recorded in the [exception registry](../engineering-exceptions.md).
