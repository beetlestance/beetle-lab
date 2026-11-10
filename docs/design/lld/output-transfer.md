# Output transport and event closure

Status: coordinator draft for independent review. No endpoints, shared types or
migration IDs are accepted by this draft. Depends on implemented
[source Journal](output-source-journal.md); backend accounting is in
[adoption](output-adoption.md). Existing source and event contracts remain binding.

## Delivery closure

A source commit and physical execution release do not close the agent event stream.
Before final result publication, persist one immutable DeliveryClosure bound to
journalAuthority, original scope/intent, manifestDigest and sourceDigest. It records
version1 and finalAgentSeq, the exact current durable event high-water. No timestamp
or independently generated closure ID is needed: the original source tuple is unique.

The installation owner may request closure only after physical source release and
successful retirement of its controller, supervisor, watches, cancellations and
all event-producing originals. The Journal validates the stored source/receipt and
released reservation, captures finalAgentSeq itself, charges closure metadata and
atomically fences subsequent control/supervisor appends for that attempt. A caller
cannot supply the high-water or claim quiescence over HTTP. Exact replay returns
unchanged closure, including after lost reply/reopen. Unknown/failed close retains
obligations; it does not mark events complete. On restart, source-first recovery
must retire its original owners before requesting a missing closure.

Closure metadata is capped at1024 canonical bytes plus256 row allowance and remains
charged under agent journal quota. Its new charge must join every live quota guard;
no ACK/prune refund. No migration number is reserved yet. Closure proves a fixed
stream end under trusted process ownership, not artifact durability or test outcome.
Nonexecution/error stream closure without a source needs a separately reviewed
proof and is still required before the whole first release can qualify.

## Private wire

All routes retain existing bearer authentication, captured physical authority,
namespace/generation headers, exact attempt binding and fixed safe errors.
No browser access, redirects, compression, alternate origin or raw host paths.

| Operation | Request | Successful reply |
| --- | --- | --- |
| GET /runner/v1/attempts/:id/source | Header scope only | SourceEnvelope |
| POST /runner/v1/attempts/:id/source/chunk | SourceChunkRequest | SourceChunk |

SourceEnvelope is closed {version:1, manifest:PublicManifest, sourceDigest,
closure:DeliveryClosure}. PublicManifest preserves its accepted preimage, result
seal and<=73728-byte cap. Envelope<=75776 UTF-8 bytes. Private root/checkpoint/
create/start/runtime evidence never enter it. Backend verifies the public digest
and result seal and treats sourceDigest as opaque authenticated source identity.
A source with no durable closure returns a typed pending response, never an empty
manifest or a high-water sampled by the HTTP handler.

SourceChunkRequest is closed {version:1, manifestDigest, sourceDigest, artifactId,
offset, length}. Digests are lowercase64 hex, artifactId the declared UUID,
offset a safe nonnegative integer, length integer1..65536; request<=1024 bytes.
Selectors resolve only an artifact in that exact stored source. No path, raw
engine-result file, arbitrary range header or undeclared file selector is accepted.
The canonical result already travels once inside PublicManifest.

SourceChunk is closed {version:1, manifestDigest, sourceDigest, artifactId,
offset, nextOffset, totalBytes, eof, base64}. Reply<=90112 UTF-8 bytes. Base64 is
canonical padded RFC4648, decoded length<=65536; validate encoded size before decode.
Require nextOffset=offset+decodedBytes safely, totalBytes=declared artifact bytes,
decodedBytes=min(length,totalBytes-offset), eof iff nextOffset=totalBytes.
offset>totalBytes refuses. offset=totalBytes returns empty canonical base64 and
explicit eof, including a zero-byte artifact after actual checked open/close.
No per-chunk checksum substitutes for backend whole-file SHA256 verification.

Canonical JSON chunks reuse the existing generated JSON gateway instead of a
second binary client/pool. Their base64 overhead is explicit and bounded; measure
large local transfer before Linux qualification. Schema generation must share the
public source value owner rather than copying agent codec/manifest logic.

## Original byte custody

The agent file owner reuses existing output/root custody primitives. Each range
opens the pinned canonical root and declared file with stored identity/uid/modes,
checks declared size and symlink/link/ancestor policy, reads<=65536 bytes, rechecks
named/descriptor identity and closes every original before positive reply. Same
names after replacement confer no authority. Missing old profile/root refuses;
current catalogue defaults cannot replace original custody. File mutation preserves
the source and returns an explicit failure, never replacement bytes under its ID.

Acquire a two-source-original byte window before request body parse/capture and
file IO. It is a subset of existing32 server RequestWork calls; reject saturation
without queue. Client source calls share the existing eight ordinary gateway
credits and a maximum-two source subset, not a separate connection pool. Manifest
and chunk calls both use that subset, retaining credit through actual native
request/result/response/socket cleanup. Existing two Offer credits remain unchanged.

The native source read owns one bounded buffer and encoded reply; serialization is
bounded before response copy. Disconnect/deadline is a stop hint and cannot drop
issued reads, closes or credits. Server shutdown fences intake and drains original
service work; backend gateway close retains its existing native-drain semantics.
No source deletion/retention refund or finalization ACK endpoint is introduced by
transport alone. A later delete owner must exclude every issued source read.

## Required evidence

Actual authenticated compiled HTTP/gateway and native files: exact bytes across
multiple ranges, canonical base64/size rejection before decode, explicit zero-byte
EOF, wrong source/manifest/artifact/scope/UUID, root/file replacement and mutation,
held native read/close through disconnect/deadline/shutdown, both shared-credit
boundaries and reply caps before allocation. Persist closure after producer drain,
reject late appends, withhold actual closure COMMIT reply and reconcile after reopen.
Backend must not finalize from source commit, snapshot.lastSeq or an empty batch.
