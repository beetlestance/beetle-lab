# Input HTTP lifetime and transfer

Status: routes and configured startup locally verified; browser transfers pending.
[Publication](input-publication.md) owns metadata, byte custody and service admission.
This document owns only the guarded public transport and its shutdown boundary.

## Composition

`registerInputRoutes(server, InputRouteOptions): InputHttp` is exported by the
inbound inputs module. [Options](../../../app/src/adapters/inbound/http/inputs/types.ts)
require the actual InputService, cryptographic server-ID allocator and existing
local-session guard. No default authentication, storage writer or filesystem adapter.
Register after shipped schema compilers. Bootstrap retains the returned close owner.
No fake upload routes when the byte service is absent.

The generated five JSON operations use registerApiOperation with64KiB body bounds.
The adapter's optional signalFor supplies this transport owner's captured signal;
other routes retain their current defaults. Scope/path equality precedes service
control, and list replies add the route's workspace scope to the private page.
Create allocates an opaque ID; receipt replay may return the original allocation.
Seal/delete202 responses remain acceptance, not completion. Get/list are authoritative
metadata observations, not attestations against subsequent local-admin file changes.

All input routes run the existing session/origin/CSRF guard in onRequest before body
consumption. Validate route UUIDs and binary query/header shape at this same boundary.
Do not register a global parser or widen the generic JSON transport. Scope the
octet-stream parser to the input plugin; it passes through the unconsumed payload
stream. The service must acquire its global2/per-input1 owner before the lazy source
reads any bytes. A parser bodyLimit alone does not bound a pass-through stream.

## Chunk upload

PUT `/inputs/{inputId}/chunks?offset=N` accepts only application/octet-stream.
Offset is one canonical unsigned decimal safe integer <=8388608; duplicates,
unknown query keys, exponent/negative/leading-zero forms reject before body reads.
If present, Content-Length is one decimal1..65536; reject declared excess before
consumption. Chunked transfer is allowed. Read into at most64KiB, reject actual
excess/empty body, and keep original stream/callback ownership until settlement.
Neither a body parse error nor response close advances offset or releases native work.
The successful200 JSON acknowledgement is the latest validated InputRecord from
InputService.append, including unchanged version/offset for an identical retry.
Byte identity comparison and partial-overlap/gap rejection belong to the byte service.

InputService normalizes consumer exceptions. The trusted HTTP source therefore
retains its own fixed body fault (e.g.413 body_limit) for response classification;
it cannot let arbitrary callback exceptions impersonate conclusive filesystem damage.
Rejected/unconsumed requests close their connection rather than retaining a body
waiter or starting an unbounded drain. No automatic chunk or control reissue.

## Content download

GET `/inputs/{inputId}/content` has no query/body and reads published inputs only.
Support a single HTTP byte range: explicit start/end, open end or positive suffix;
clamp a legal end to bytes-1. Empty files support full200 only. Invalid, multiple or
unsatisfiable ranges return416 with Content-Range `bytes */<size>` and the fixed
invalid_value body from apiErrorResponse. This status exception is confined to ranges.
If-Range matches the strong quoted SHA256 ETag; otherwise ignore Range and send full200.
Do not implement conditional304, multipart ranges or compression in this packet.

Successful replies use application/octet-stream, nosniff, no-store, Accept-Ranges:
bytes and a strong quoted SHA256 ETag. Partial206 adds exact Content-Range. Attachment
names are derived ASCII input-<UUID>.bin, never display names or local paths.
Require backend HTTP/1.1 for content requests; reject other upstream versions before
service issue with malformed_request. Frontend proxies must use upstream HTTP/1.1.

Nonempty downloads use chunked framing without Content-Length. Start headers only
on the first sink callback, after the service's complete hash verification; await
each original raw write/backpressure callback. Send the terminal chunk via raw.end
only after InputService.read succeeds, including final verification and all original
file/directory closes. On failure destroy the started response without its terminal
framing; never append JSON. Receipt of the expected byte count alone is not download
completion: clients must consume through successful message termination. An empty
download sends Content-Length:0 only after the read and its closes succeed.
No final-tail buffer or early sink acknowledgement is introduced. Exact byte counts
remain in metadata and Content-Range; the completion marker stays under this owner.

## Request originals and close

The server factory bounds64 sockets,30s request/socket timeouts,5s headers/keepalive.
The input transport additionally owns at most64 active request contexts, no waiters.
Each captures one30s deadline and abort controller before parsing. A context owns
its source/sink and issued service promise independently of response completion.
Timeout/disconnect fences future work and interrupts its owned network stream;
it cannot retire a still-issued service/native original. No detached retry timers.

Normal IncomingMessage close after a complete body is not cancellation or operation
settlement. Use explicit request abort/incomplete close and response close, with
idempotent cleanup. Do not directly bind service work to Fastify request.signal's
raw-close lifetime. A completed response can retire a context only after its original
service promise settles. Parser/validation failures without issue release once.

InputHttp.close synchronously fences intake, aborts contexts and destroys owned
stalled streams/responses, then drains issued service promises. Wire it to preClose
and expose it for direct bootstrap shutdown. Bootstrap starts InputHttp.close and
InputService.close independently before waiting, then drains the server and metadata;
it must not deadlock by awaiting service close before aborting a held HTTP source.
Metadata close follows byte-service drain. Failed native close still leaves the
service's custody owner pending; HTTP response cleanup is not a substitute.
Startup initializes one private durable input tree at a time per process. An unknown
directory-close outcome retains its handle and pending initialization; another
initialization is fenced. It cannot report successful startup or cleanup.

## Acceptance

Actual paired create/chunk/retry/seal/status/read/range/delete through real SQLite
and files, including empty/UTF8 content, namespace/folder/pin/version conflicts and
unknown-write receipt replay. Invalid auth/origin/CSRF/path/query/content type/declared
excess must reject before body consumption or service issue. Test actual chunked
excess/empty bodies, parser aborts, stalled sources, sink backpressure, two service
slots/third refusal, control responsiveness, disconnect after issue, normal body
close, and close while upload/read/metadata originals remain held. Use task-owned
loopback sockets with coordinator authorization; injection alone cannot prove these.
Hold final verification/file close after the peer has received every expected data
byte: its message must remain incomplete until successful close. Failure must abort
the message without terminal framing, including range replies. Empty replies cannot
complete their headers before close. Verify the frontend proxy preserves this rule.
No browser/native image/RSS/stop-latency/release claim follows from transport tests.

Implementation references: [Fastify content parsers](https://fastify.dev/docs/latest/Reference/ContentTypeParser/)
and [server options](https://fastify.dev/docs/latest/Reference/Server/). Verify behavior
against pinned installed source; a documented framework timeout does not prove that
application originals or descriptor cleanup have settled.
