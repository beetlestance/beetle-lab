# Verified run artifact downloads

Status: accepted backend implementation contract. Reuses
[output files](output-files.md) and [finalization](output-finalization.md).
Browser download controls are a subsequent consumer batch.

## Scoped publication metadata

Generated listRunArtifacts reads
`/organizations/:org/workspaces/:ws/runs/:run/attempts/:attempt/artifacts` beneath
/api/v2 with PageQuery limit1..100 and optional canonical opaque cursor.
RunArtifactPage carries run/scope/attempt/generation1, availability, manifestDigest,
items and nextCursor; the full reply is <=73,728 bytes. Items are existing artifact
descriptors. They are publication metadata, not a current filesystem health probe.

Resolve the scoped Run before its requested owned Attempt. Historical owned
attempts remain readable after a different attempt becomes active; never substitute
Run.activeAttemptId or its current engine pins for the requested attempt's evidence.
Wrong namespace/run/attempt/artifact returns404. No config/Offer body, writer claim,
ACK, event ingestion, accounting, finalization or cleanup effect occurs on GET.

Only matching execution_output_finalizations grants ready; require exact stored
source/manifest/physical binding and published slots with full bytes, nonnull native
identity and null writer. Source-free finalization grants absent with no items.
Otherwise return pending with no items/manifestDigest. Contradictory/corrupt evidence
fails unavailable. Native file access still validates physical custody independently.

List cursors are closed canonical base64url, <=512 bytes, bound to a distinct
artifact lane, namespace/run/requested attempt/generation1/manifest digest and next
ordinal. Reject foreign, stale, unsafe or noncanonical positions. Read at most the
existing128 descriptors/slots through their bounded shared owner, then select the
requested <=100 descriptors; never materialize raw history or file contents.

Private RunArtifactsReader has listRunArtifacts(RunArtifactListQuery) and
getRunArtifact(RunArtifactKey). Metadata.runArtifacts and listRunArtifacts /
getRunArtifact worker operations use the frozen port/protocol. File lookup returns
only the exact published OutputFileRecord, <=4096 bytes, matching the requested
artifact and scope/attempt. Pending publication is conflict, not an empty file.
Public list client and private reply codecs validate identity/availability/cursors,
uniqueness and complete byte bounds. Shared pure encodeRunArtifactCursor,
captureRunArtifactCursor and runArtifactPageMatches belong in contracts/api; both
client and metadata reuse them.

## Content and native ownership

The same-origin content route and path builder are exported by contracts/api:
`/runs/:run/attempts/:attempt/artifacts/:artifact/content` under the scoped prefix.
Use the local session/Host/Origin guard, strict five-UUID params, no body/query,
and one supported byte range with the existing input range semantics. Invalid or
unsatisfiable ranges return416; If-Range behaves as on input content. Disable
implicit HEAD. Use octet-stream, nosniff, no-store, SHA ETag and a fixed UUID-only
attachment filename; engine relative paths never choose a file or header.

Reuse the existing installation OutputByteStore.read. Do not open another namespace
lease, reconstruct a path or create a second filesystem reader. The concrete
OutputRuntime exposes publishedBytes.read; AgentOwners captures it for AgentRuntime.
The real openAgentRuntime/startup requires that capability; configurations without
an agent may list metadata but content is explicitly unavailable. Optional typing
supports existing owner fixtures without inventing a successful byte adapter.

Allow at most one active HTTP download, including metadata/native originals, with
no waiting queue. This shares the native store's existing two-job/token credits,
leaving publication capacity. Capture a fixed30s monotonic deadline and AbortSignal;
reads use zero free-space write reserve. A read issues one native job over the
selected range, not separate unpinned per-chunk jobs. Its sink awaits actual socket
callback/drain, retaining bounded <=64KiB chunks. Extract common HTTP range/write
helpers from input content rather than duplicating them; preserve input semantics.

Use chunked framing for nonempty content and send its terminating EOF only after
both native result and settlement/post-close verification succeed. Do not let a
Content-Length-complete response claim success before original custody checks.
Full reads also hash streamed bytes and compare the declared SHA before EOF; ranges
retain physical custody and exact selected-length checks, not an independent full-file
SHA claim. Empty content requires the same verified read before returning length0. Midstream
errors destroy the response; never append JSON to artifact bytes. Disconnect,
timeout and application close abort writes, fence new work and drain owned calls.
Unknown/failed native cleanup remains an explicit failure with ownership retained.

Known OutputByteError.busy is refusal before native I/O. Preserve it as transfer
busy so a concurrent download defers publication rather than failing the runtime;
reuse stored logical writer on retry. Do not relabel I/O, cleanup, capacity or
unknown metadata failures as busy, and do not increase native credit limits.

## Acceptance

Use actual scoped metadata adoption/publication/finalization and native output
files through authenticated synthetic TCP/worker reads. Cover full/range/empty,
wrong scopes/attempts/IDs, pending/absent, cursor/limits, corruption and missing file,
immutable charges/ACK, shared busy/refused writer recovery, disconnect, held sink,
late native settlement, EOF withholding and shutdown. A SQL published flag alone
cannot make an arbitrary file pass. Reuse existing byte-owner fixtures and oracles.

Run changed feature tests, affected input HTTP/transfer controls, Node types and
changed lint. Coordinator reviews once and checks the changed composed seam. No
Docker/build/full-suite/real credentials or browser/native-engine qualification.
