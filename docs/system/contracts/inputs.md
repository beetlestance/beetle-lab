# Inputs

Published inputs carry dataset and request-body bytes from the browser to an
engine attempt. The browser byte client (`contracts/src/api/input-transfer/`)
talks to the guarded HTTP transport (`app/src/adapters/inbound/http/inputs/`),
which drives the input service (`app/src/application/inputs/`), the sole SQLite
metadata worker and the private byte adapter. Suite revisions pin published
inputs; the installed provider and stager read them for execution.

## Identity and routes

Every operation binds organisation, workspace and input UUIDs, compared without
case and persisted lowercase. An input has an opaque server-allocated ID, a name
(namespace normalisation; never a file path), a same-workspace folder (omission
selects the workspace root folder) and an immutable expected SHA-256 and size.

| Route under `/api/v2/organizations/{o}/workspaces/{w}/inputs` | Owner | Success |
| --- | --- | --- |
| `POST` (create), `GET` (page) | generated JSON operation | 201 staging record / 200 page |
| `GET /{id}` | generated JSON operation | 200 authoritative record |
| `GET /{id}/usage`, `GET /{id}/columns` | generated JSON operation | 200 pinning revisions or verified column discovery ([metadata](input-metadata.md)) |
| `PUT /{id}/chunks?offset=N` | byte route | 200 latest `InputRecord` |
| `POST /{id}/seal`, `DELETE /{id}` | generated JSON operation | 202 `InputReceipt` |
| `GET /{id}/content` | byte route, published inputs only | 200 or 206 |

JSON shapes live in `contracts/src/api/generated/input.ts` and
`input-requests.ts`. `INPUT_CHUNK_ROUTE`, `INPUT_CONTENT_ROUTE`,
`inputChunkPath`/`inputContentPath` and `INPUT_CHUNK_BYTES` in
`contracts/src/api/input-content.ts` are the single owner of the byte URI
templates, shared by client, server and the embedded reference
(`apiBinaryOperations`). Public records never contain a local path, resolved
secret or content.

## Limits

| Limit | Value | Enforced in |
| --- | --- | --- |
| Input size | 0 to 8 MiB (8,388,608 bytes) | `app/src/ports/inputs.ts`, client `preparation.ts` |
| Chunk | 1 to 64 KiB; none for an empty input | `INPUT_CHUNK_BYTES`, inputs `body.ts` |
| Metadata charge per input | 64 KiB, retained with the tombstone | `INPUT_METADATA_CHARGE_BYTES` |
| Page | at most 100 records | generated `PageQuery` |
| Byte operations | 2 global, 1 per input, no queue | `application/inputs/ownership.ts` |
| HTTP input contexts | 64, each with one 30 s deadline, no waiters | `request-lifetimes/` |
| Client operations | 2 per client (prepare and transfers share), no queue | `input-transfer/index.ts` |
| Client JSON reply | 64 KiB per operation | `input-transfer/response.ts` |
| JSON control bodies | 64 KiB | inputs `json.ts` |

## Lifecycle

| State | Allowed progress | Byte authority |
| --- | --- | --- |
| `staging` | append; begin publishing; begin deletion | committed prefix only |
| `publishing` | verify and promote; commit published; begin deletion | no revision pin yet |
| `published` | read, pin; begin deletion when unpinned | verified publication |
| `deleting` | durable cleanup; commit deleted | fenced from new pins and reads |
| `deleted` | tombstone only | durable absence established |
| `failed` | explicit deletion | unknown custody stays charged |

- Every advance compares the exact version. Committed offsets and lifecycle
  transitions increment `version`; an identical replay does not.
- Progress requires `staging` and a strictly increasing offset no larger than
  `bytes`. Seal consumes its intent only from `staging` with `offset == bytes`.
- Only a conclusive custody failure (`custody_missing`, `integrity`), recorded
  after every original has settled, fences `staging`, `publishing` or `published`
  as `failed` (`app/src/application/inputs/reconcile.ts`). Transient IO and
  cancellation leave state and charge unchanged; `io` is recorded only on a
  `deleting` row. No transition leaves `failed` except deletion. `deleting` keeps its state and
  intent on cleanup failure, with a fixed safe reason; recovery finishes it
  without another delete key. `deleted` rejects every change.
- Failure reasons: `custody_missing`, `integrity`, `io`, `unverified_legacy`.

## Control idempotency

| Operation | Request binds | Replay rule |
| --- | --- | --- |
| Create | `requestId`, scope, name, optional folder, hash, size | metadata only; replay returns the original allocation |
| Seal, delete | `requestId`, scope, `expectedVersion` | original receipt, even when work is still pending |

- Receipt lookup precedes current-state and version checks; a changed intent
  under the same key conflicts across operation kinds.
- Each input owns at most one create, seal and deletion intent. A new key cannot
  mint another receipt for an existing seal or delete; retry the original.
- A 202 receipt is acceptance, never proof of publication or released storage.
  `GET /{id}` is authoritative. Replay cannot recreate deleted bytes or
  republish a deleting, deleted or failed input.
- Unknown metadata outcomes trigger no internal retry, compensation or
  dependent byte work; a later explicit call reobserves the row.

## Byte custody

- Append starts exactly at the committed offset and never exceeds `bytes`. A
  retry wholly inside the committed prefix must compare identical bytes and
  leaves offset and version unchanged; gaps, changed bytes and partial overlaps
  fail. Bytes are flushed before the offset advances; no per-chunk receipts.
- After a crash, excess file bytes are truncated to the committed offset and
  flushed before the next append. Shorter or mismatched custody fails closed.
- Publication commits only after exact size and hash verification, file flush,
  no-overwrite promotion (`link` then unlink staging) and flushes of both parent
  directories. During `publishing` only, exactly the two deterministic names may
  alias one verified inode (`nlink` 2, mode 0600, same UID). Any other alias,
  inode or ownership blocks overwrite and unlink. No rename or copy fallback.
- The only reconstructible case is `publishing` with `bytes = offset = 0` and the
  empty SHA-256. Committed prefixes and published or deleted files are never
  synthesised from metadata.
- Delete atomically requires no retained revision pins (else 409
  `protected_dependency` naming the first blockers) and blocks new pins. It removes
  only the two derived names (private, same UID, single link, or the proven alias),
  flushes parents, then commits `deleted` and releases the payload
  charge. Unknown cleanup keeps the charge. Retention is manual; abandoned
  uploads need explicit deletion.
- Layout: a canonical private root, `inputRoot/organisation/workspace/inputId/sha256`
  for published bytes, staging as a sibling on the same filesystem. Files are
  0600 single-link regular files, directories 0700, no symlinked parents. The
  backend alone writes; the agent mounts the published subtree read-only.
- Abort or timeout fences later work but keeps the original open, read, write,
  flush and close until it settles. A failed descriptor close fences the service
  and keeps its slot and charge; nothing frees on garbage collection.
- Recovery reads pages of at most 100, skips busy rows without waiting and
  restarts from the beginning after a pass; a page end is not completion proof.
  Private `mode: pending` selects only `publishing`/`deleting` rows through the
  recovery index. No public route exposes recovery.

## Quota

The metadata worker reserves `bytes + 64 KiB` per input in the single
installation usage counter, requiring
`charged + payload + metadata + freeSpaceReserveBytes <= pool.storageBytes` with
checked safe-integer arithmetic. Lowering settings can leave usage over budget:
existing charges stay, new allocations are refused and nothing is purged.
Physical free-space checks supplement the logical counter; `ENOSPC` is an
explicit failure. The counter is not a filesystem quota.

## Transport rules

All input routes run the local session, origin and CSRF guard in `onRequest`
before any body is consumed. Route UUIDs, query and headers validate at the same
boundary. The octet-stream parser is scoped to the input plugin and passes the
unconsumed stream through; the service acquires capacity before the lazy source
reads a byte.

| Rule | Chunk upload | Content download |
| --- | --- | --- |
| Request | `application/octet-stream`, no `Content-Encoding`; `offset` one canonical decimal ≤ 8,388,608 | no query or body; HTTP/1.1 only, no `Transfer-Encoding` |
| Size | `Content-Length` (if present) 1 to 65,536, declared excess is 413 before reading; actual excess or empty body rejects | — |
| Ranges | — | one range (explicit, open end or suffix); invalid, multiple or unsatisfiable is 416 with `bytes */<size>`; empty files only full 200 |
| Conditional | — | `If-Range` against the strong quoted SHA-256 `ETag`; mismatch sends full 200; no 304, multipart or compression |
| Headers | — | octet-stream, `nosniff`, `no-store`, `Accept-Ranges: bytes`, attachment `input-<UUID>.bin` |

- Nonempty content uses chunked framing without `Content-Length`. Headers start
  only after full hash verification; the terminal chunk is sent only after the
  service read, final verification and every descriptor close succeed. On
  failure the started response is destroyed without terminal framing. A client
  must read through successful message termination; the byte count alone is not
  completion. An empty download sends `Content-Length: 0` only after success.
- A body parse error or response close never advances the offset or releases
  native work. Rejected requests close their connection rather than drain.
- `InputHttp.close` fences intake, aborts contexts and destroys stalled streams,
  then drains issued service promises. Bootstrap starts it and the service
  close independently before waiting, then closes metadata.

## Browser client

`createInputTransferClient` (types in `contracts/src/api/input-transfer-types.ts`)
offers `prepare`, `append`, full download and `close`; no range client.

- Configuration is snapshotted once: same-origin HTTP(S) base URL ≤ 2048
  characters without credentials, query, hash or path; timeout 1 to 30,000 ms
  (default 30,000); at most 32 headers, values ≤ 2048 characters, ≤ 8192 UTF-8
  bytes in total. Content and transfer headers, `Host`, `Connection`, `Range`,
  `If-*`, `Origin` and `Cookie` are reserved. Fetch uses `redirect: 'error'`.
- Every failure carries `issued`; `false` means no fetch began. `busy` and
  `closed` are local. After issue an upload outcome is uncertain: callers read
  status and resume or replay explicitly. Nothing retries automatically.
- `prepare` refuses Blobs over 8 MiB before reading and returns bytes only after
  the native SHA-256 completes.
- An append acknowledgement must be 200 `staging` with no reason, match every
  immutable field and report `offset + length`, `version + 1`; a retry wholly
  inside the committed prefix keeps offset and version.
- A download requires 200, octet-stream, the expected strong `ETag`, identity
  encoding, and `Content-Length` absent (or zero when empty). It reads to EOF,
  then verifies SHA-256 with Web Crypto; missing crypto fails.
- Close fences intake, aborts operations and settles only after every issued
  original (fetch, read, cancel, digest) settles; cleanup failure rejects it.

## Request bodies from inputs

The shared k6 suite compiler and renderer (`engines/k6/compiler/suite/`) own body
expansion; there is no second compiler.

| Limit | Value |
| --- | --- |
| Input or rendered body | 8 MiB |
| Aggregate loaded content | 32 MiB |
| Configuration | 1 MiB |
| Template source / substitution | 4096 / 65,536 characters |
| Plan serialisation admission | 24 MiB |

A JSON string or text input without `{{` template delimiters is a literal body,
appended byte-exactly under the body cap. Content with delimiters uses the
template limits. Literal body fields serialise as streamed chunks under the
8 MiB string ceiling; other strings keep the 65,536-character cap. Large bodies
use published inputs rather than inline configuration.

## Related

- [Public API](public-api.md): authentication, scoping and receipts.
- [Retirement](retirement.md)
- [Decision 006: agent staging](../../decisions/006-agent-staging.md)
- [Decision 018: Docker host trust boundary](../../decisions/018-docker-host-trust-boundary.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/ports/inputs.ts` | `7d3f925424a0` |
| `app/src/application/inputs/` | `f49feac59a9b` |
| `app/src/adapters/inbound/http/inputs/` | `6bb4f71cd9d0` |
| `contracts/src/api/input-content.ts` | `b62f8df109dd` |
| `contracts/src/api/input-transfer/` | `09d9ef68653c` |
| `engines/k6/compiler/suite/limits.ts` | `2196d65f1ff5` |
