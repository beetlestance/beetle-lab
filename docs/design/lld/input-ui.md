# Input upload and download controls

Status: implementation contract. [Byte client](input-client.md) owns native file,
network and digest originals; [publication](input-publication.md) owns backend state.

## Composition and ownership

The workspace screen composes InputInventory with UploadInput({workspace:Workspace})
and InputDownload({record:InputRecord}) through its renderActions slot. Each feature
exports only its component from index.tsx. Root composition owns routing and the
shared ApiContext/InputTransferContext. Components use those hooks, not a new client
factory. Missing transfer context cannot render an enabled transfer control.
Existing Beetle tokens, native controls, labels and reduced motion remain the system.

The paired browser session owns one byte client. An epoch change aborts it and
waits for every original before replacement. The byte fetch wrapper observes401 but
leaves late-response cancellation to that client. Component departure aborts its
own controller and ignores late results; it does not close the shared byte client.

## One prepared upload intent

Choose one file<=8MiB, name and same-workspace folder. Root folder is the default.
Folder selection uses explicit pages<=100 and history<=20, with one selected label
retained across pages. Do not fetch an entire tree or allow another workspace ID.
One mounted workspace retains one file/prepared payload, one create identity and at
most one seal identity. No browser storage of contents, credentials or request bodies.

The submit action freezes trimmed name, folder, scope and request ID. Prepare through
the shared byte client; retain its caller-owned bounded content and SHA256. Disable
file/name/folder replacement while the intent exists. Native File reads and hashing
must never run outside the byte client's capacity owner. Never log payloads/secrets.

Normal acknowledged workflow: create -> current GET -> chunks -> seal -> current GET.
The create response is its original staging snapshot, so status is always re-read.
Bind every observed record to the original input/scope/name/folder/hash/size before
dependent byte work. A different immutable identity stops the workflow without issue.
For staging, append synchronous<=64KiB slices from the committed offset, advancing
only on validated acknowledgements. Empty input skips append. Successful progress
may continue to the next chunk; no failed request is automatically retried.

Pause after any failure/cancellation. Keep exact create body/requestId when its
outcome is unknown; explicit replay sends it unchanged, then reads status. For an
issued failed chunk, show unknown outcome and require an explicit fresh status read
before Resume. Resume uses that observed committed offset and the same prepared
content. Stale version/conflict must not discard the payload or silently mint an ID.
Metadata reads do not prove a prior server operation has stopped; identical bytes
and original receipt identities keep explicit recovery safe.

Seal only from staging with offset==bytes. Freeze one requestId/expectedVersion;
unknown seal may only replay that identical request. Its202 response is acceptance.
Publishing requires explicit later status reads; show success only after a bound
published record. Deleted/deleting/failed records stop byte progress and explain
the observed state; do not recreate an input, compensate or delete automatically.
List invalidation follows known metadata effects; no polling/retry timer.

One in-flight workflow guard prevents double submission. Cancel aborts but does not
claim rollback. Scope/session departure aborts and fences subsequent effects. Local
intent is memory-only and retires on departure; tell the user that a partial input
can remain. Explicitly discarding a paused local draft does not delete backend data.
Clear a completed/abandoned local intent before starting another; no hidden cache.

## Verified download

Only the authoritative selected published record can render InputDownload; hide
actions during metadata refresh or pending deletion as owned by InputInventory.
One operation at a time per control, using the shared byte client and its abort
signal. Wait for the full verified result before constructing a Blob/object URL.
Retain at most one ready file URL; revoke it on replacement, scope/record change or
unmount. No URL, save link or success indicator after failure, abort or a late reply.

Use a generated ASCII input-<UUID>.bin filename. A Download input action may prepare
the verified result, then expose a Save file link; explicit user activation keeps
native browser download behavior. No automatic navigation or unbounded timers.
Browser Blob copies and caller-owned ready bytes are bounded by8MiB per control,
additional to client/crypto buffers; this is not a measured process RSS claim.
Safe fixed failure text covers busy/closed/transport/protocol failures; never echo
exception text or server content. Retry is explicit and performs a new read only.

## Acceptance

Upload: empty/multiple chunks; folder pages/selection; exact create and seal replay;
unknown chunk/status/resume; wrong immutable record; pending publication; cancellation,
repeated click and held stale replies across scope/session departure. No later write
after a failed/interrupted step without explicit action. Preserve failed drafts.
Download: no action without context/published status, bytes verified before URL,
single issue, safe filename, revoke replacement/unmount, aborted/stale completion,
error without ready file and explicit retry. Integration uses real session/controller
and shipped routes; component mocks alone cannot qualify browser or proxy behavior.
