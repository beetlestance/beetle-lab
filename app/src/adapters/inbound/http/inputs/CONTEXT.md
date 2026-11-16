# Public input HTTP

`registerInputRoutes` composes generated JSON controls, lazy octet-stream chunks
and verified content reads behind the supplied local-session guard.
The service, ID allocator and authorization are required; no storage is created here.

The scoped parser leaves bytes untouched until service admission invokes the source.
Chunks are one nonempty <=64KiB body. The transport owns <=64 contexts, each with
one 30s deadline, and retains issued original promises through cancellation/response
completion. Normal completed request-body close does not cancel service work.
Close fences intake, aborts/destroys network streams and drains service promises;
bootstrap must start service close independently. HTTP never closes metadata/service.

Nonempty content uses HTTP/1.1 chunked framing. Every sink awaits write/backpressure;
only successful service read/final verification/descriptor close permits raw.end.
Failures after headers destroy the incomplete message. Empty headers wait for read
success. Single ranges and strong If-Range are supported; content has no auto HEAD.

Owner contract: docs/design/lld/input-http.md and input-publication.md.
Focused checks: Vitest app/test/http/inputs (socket files require authorized loopback).
Tests distinguish actual native file/SQLite composition from modeled finalization.
