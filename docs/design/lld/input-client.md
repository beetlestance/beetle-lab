# Browser input byte client

Status: implementation locally verified; browser/session integration pending.
The [HTTP contract](input-http.md) owns transport and message termination.
The [publication contract](input-publication.md) owns durable progress and receipts.

## Public surface

`createInputTransferClient(InputTransferOptions): InputTransferClient` is a narrow
contracts API export alongside the JSON ApiClient. Its [types](../../../contracts/src/api/input-transfer-types.ts)
define file preparation, append, full download and close. No range client, SDK publication or generic
JSON transport changes. Configure only a trusted same-origin service URL, fixed
session headers, optional fetch seam and timeout1..30000ms (default30000).
Snapshot configuration once; reject credentials/query/hash/path in base URLs,
unsafe header names and invalid options before creating an owner. Never redirect
credential-bearing requests: fetch uses redirect:error and same-origin credentials.
Options/headers are plain data without accessors/extra option keys. Allow at most
32 headers, names<=64 characters, values<=2048 characters and total UTF8<=8192 bytes;
reject CR/LF and Content-Type/Length/Encoding, Transfer-Encoding, Host, Connection,
Range, If-Range and other conditional If-* headers (case-insensitive). The owner
sets transfer headers. Snapshot base URL<=2048 characters and require HTTP(S).
Browser-owned Origin/Cookie and connection/security headers are also reserved.
Browsers supply origin/cookies through their native transport; a Node fixture may
emulate that behavior in its trusted fetch adapter without weakening this guard.

Each failure includes issued:boolean. False means no fetch invocation began; it
does not assert anything about previous attempts. Busy/closed are local pre-issue
failures. Other failure kinds reuse ApiClientFailure. After issue, any failed upload
has an uncertain outcome; callers inspect status and explicitly resume/replay.
Never retry uploads, receipts or requests automatically.

## Admission and originals

One client owns at most two complete operations, no wait queue. Reserve a carrier
before invoking any foreign fetch/read/cancel/digest work. Reject excess with busy;
close synchronously fences intake and aborts all active operation controllers.
Track original promises through settlement, even when a timeout or caller abort
has already made their results unusable. No race wrapper retires their capacity.
Close returns one retained promise and cannot finish before those originals settle.
Client close aborts an active operation as cancelled with its actual issued flag;
closed is reserved for later intake. Cleanup failure rejects close only after all
issued originals settle; no successful operation may hide such failure.
An adapter that ignores abort can keep its operation/close pending; this is truthful
custody, not a claim of a hard browser resource or time limit.

One deadline covers fetch, response parsing and verification. Compose caller abort,
deadline and client close. Check abort before each new dependent operation and after
each original settlement. On abort/error, cancel an acquired reader at most once;
retain both its in-flight read and cancel promises before releasing its lock. A late
fetch response must have its unconsumed body cancelled and cancellation drained.
Never hide cleanup failure as success. Abort listeners and timers retire exactly once.

## File preparation

`prepare({file:Blob,signal?})` shares the same two-operation owner and returns
`{sha256,content:Uint8Array}`. It never issues fetch, so all its failures have
issued:false. Capture a strict plain request without invoking accessors; use native
Blob brand/size and Blob.prototype.arrayBuffer, not replaceable instance methods.
Reject size>8MiB before reading. Retain the original buffer read and native digest
through cancellation/close, check exact actual length and abort between originals.
Return the bounded bytes only after digest success. Do not cache prepared content.

The UI retains one prepared upload intent, taking synchronous64KiB subarrays for
append rather than starting unowned per-chunk File reads. Caller retention is outside
the client's active buffers; abandoning a view cannot release an active preparation
slot early. Session replacement drains the old client before creating another.

## Append and acknowledgement

Capture strict plain request/record data before asynchronous work; reject accessors,
unknown fields, invalid signals and invalid InputRecord shapes without executing
their getters. Enforce existing lifecycle/progress invariants and lowercase route
UUIDs. Copy one native Uint8Array chunk1..65536 before fetch; later caller mutation
cannot change its intent. Offset is a safe integer0..8388608, <=record.offset and
offset+chunk.length<=record.bytes. Append requires staging with no failure reason.
The record is a status snapshot, not authority to skip backend validation.

PUT the derived workspace/input chunks URL with application/octet-stream. Read
response bytes incrementally through EOF, max65536, then strict UTF8/JSON/ApiError
or InputRecord validation. Never use unbounded response.json/text/arrayBuffer.
Only200 acknowledges append, with state:staging and reason:null. Bind all immutable fields to the captured record
(UUIDs/scope/folder/name/hash/size). A fresh append at current offset must acknowledge
offset+length and version+1. A retry wholly before the committed offset preserves
offset/version; partial overlap is invalid locally. These checks detect response
corruption; a stale snapshot may require a fresh status query before another attempt.

## Full download

Require a published record and GET its derived content URL without Range. Only200
with application/octet-stream, the strong quoted expected SHA256 ETag and no
Content-Encoding other than identity is valid. No caller-supplied Range or
conditional headers. Validate Content-Length if present: zero for empty input;
nonempty downloads must omit it so completion stays under the server's owner.
Read through successful stream EOF, including after the exact expected byte count.
Truncation, excess, stream failure after all expected bytes or aborted completion
is failure. A count alone never proves success. Validate the complete SHA256 with
native Web Crypto after EOF and return the bytes only after digest settlement.

Preallocate at most the expected0..8MiB and copy incoming chunks only while within
that bound. JSON replies use at most64KiB per operation. No whole-response helper,
unbounded chunk list or persistent payload cache. Two full downloads retain at most
16MiB of client output buffers (preparation and download share the two slots);
browser network/file chunks, crypto copies and caller
retention are additional and must not be advertised as measured process RSS.
Native crypto is required; unavailable crypto fails, never skips integrity checks.

## Acceptance

Synthetic Blob/fetch/streams cover maximum-size input, empty and UTF8 bytes, exact
acknowledgement/retry binding, wrong identities/progress/headers/hash, safe error
bodies, truncation/excess and failure after every expected byte. Hold original fetch,
read, cancel and digest through abort/close: no new issue, third operation refuses,
and close waits. Exercise reentrant close from foreign work, mutation after call,
invalid accessor/getter and redirection policy. Preparation must reject oversize
before reading and retain held buffer/digest originals without network issue.
Never lower existing gates/deadlines.
An actual task-owned HTTP fixture verifies the client against the shipped routes.
Browser/session epoch integration, UI and frontend proxy semantics need separate
acceptance; unit streams cannot qualify real browser buffering or container behavior.
