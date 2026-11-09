# Private runner HTTP adapter

Status: implemented and independently reviewed component. The adapter constructs Fastify;
installation bootstrap owns listening, private networking, scheduling and shutdown.
It implements the six existing generated runner operations. Artifact streaming and
explicit application finalization acknowledgements remain separate work.

## Authentication and scope

Every route requires exactly one Authorization header: `Bearer <installation token>`.
The mounted token is43-128 base64url/hex-compatible characters, supplied by trusted
installation configuration. The adapter compares fixed-size SHA256 digests and never
returns/logs the token. Missing/invalid credentials fail before body parsing or
service invocation. Origin, Cookie and browser site headers reject; no browser or
engine receives this credential. Compose must not publish the agent port.

Attempt routes additionally require:

- `x-beetle-organization-id`: UUID.
- `x-beetle-workspace-id`: UUID.
- `x-beetle-generation`: canonical positive decimal safe integer.

The generated client's HttpOptions.headers supplies these backend-owned values.
Path attempt ID, header scope and mutation DTO identities must match. GETs fence
stale generations before returning scoped state/events. The initial Offer always
uses generation1; future ownership generations cannot be requested through Offer.
Capabilities are installation-wide and require authentication without a namespace.

Authentication/invalid-scope failures and global failures may return only an HTTP
status with an empty body: there is no authoritative organisation/workspace for a
ProtocolError. The client reports a transport/response failure, not a fabricated
namespace. Once scope is established, errors use bounded validated ProtocolError
objects with fixed reasons and no exception/config/URL values.

## Bounded JSON and operations

Bodies and replies are at most1MiB. Runner validators reject unsupported fields;
there is no coercion, default insertion or arbitrary schema compilation. Replies
are encoded/snapshotted before reading fields or choosing Fastify serializers;
only validated objects are sent. Reply scope/generation must match the request.
Event cursors are canonical nonnegative decimals; duplicate/unknown query fields
reject. Event batches and ACKs retain existing100-event/256KiB journal semantics.

At most32 original service calls are retained concurrently, with64 sockets and
30-second request/connection limits. Saturation returns429 without queueing work.
Socket/client completion does not release the original service-operation owner.
Server preClose fences new service calls and waits for every original result.
Bootstrap then drains installation work before closing its journal; a request
response does not establish runtime termination or application finalization.

The adapter exposes no drive/launch/profile/schema/Docker flag endpoint. Offer
only queues through the trusted InstallationController. Cancellation persists
intent through that service. Snapshot/events/ACK use scoped journal methods.
No automatic request or test retry is performed.

[Delivery authority](delivery-authority.md) additionally requires exactly one private
authority header checked before normal attempt reads/mutations. Missing/mismatch
must remain distinct from a scoped receipt404. This extension is not implemented;
existing HTTP component evidence does not establish restore-safe automatic replay.
