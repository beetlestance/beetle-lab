# Suite authoring and immutable revisions

Status: implemented and independently reviewed; application migration002 applied.
Local functional evidence: [suite authoring](../../verification/suite-authoring.md).
Owner seams: `app/src/ports/suites.ts`, generated API suite DTOs/operations.
This adds real persisted authoring; execution/input publication follow separately.

## API and ownership

Routes are nested under `/api/v2/organizations/{organizationId}/workspaces/{workspaceId}`.
GET/POST `/suites`, GET/PATCH `/suites/{suiteId}`, GET/POST
`/suites/{suiteId}/revisions`, GET `/revisions/{revisionId}` are the frozen routes.
Use the existing local session/origin/CSRF guard and generated operation adapter.
Every lookup, mutation, receipt, cursor and response binds the complete workspace
scope. Wrong ownership yields scoped404. UUID identity is case insensitive and
persisted lowercase. Name normalization/folding matches existing namespace rules.

Creating a suite allocates its UUID and starts version1/currentRevisionId:null.
An omitted folder uses the workspace's actual rootFolderId; explicit folders must
belong to that workspace. Name uniqueness is per folder using the established fold.
PATCH changes name/folder with expectedVersion. No arbitrary root identity or
cross-workspace move. Deletion and run pin protection remain a subsequent use case.

Creating a revision requires the current suite version, k6 engineId/configVersion1
and complete config. It returns a new immutable revision, atomically increments
the suite version and updates currentRevisionId. Earlier revisions remain readable.
Ordinal starts1 and increments within that suite, independently of metadata edits.
The shipped shared k6 schema performs structural preflight; do not copy compiler
semantics into HTTP/SQLite/UI. preflightStatus:passed means structural validation,
not semantic validation, available capacity or a successful test. Full validation
still happens under engine admission before target interaction.

InputManifest derives from config dataset references, never a second independently
submitted manifest. Deduplicate identical input identities, reject conflicting
same-ID pins, normalize UUIDs and verify every pin against a published input blob
with exact organisation/workspace/hash/size in the same metadata transaction.
No input publication endpoint is supplied by this slice: no metadata-only fake
upload or implicit availability. Secret references remain opaque, including any
declared version; do not resolve, substitute or hash environment/mounted bytes.

## Bounds and worker protocol

Config JSON retains the existing1MiB allowance, including non-ASCII byte accounting.
Canonical config serialization and shared schema validation precede persistence.
API revision mutation/detail and worker envelopes allow2MiB for config plus identity,
pins and receipts; other command inputs retain64KiB. Existing nonrevision replies
retain their separate1MiB budget. List pages contain at most
100 suite/revision summaries; revision lists omit config/inputManifest. Full revision
reads are individual. Byte/depth/property and safe integer checks remain enforced
by the existing bounded JSON encoder; no raw JSON.stringify before intake bounds.

At most two suite operations may be pending in one Metadata owner, within its
existing total queue bound. Close keeps its reserved slot. The worker remains the
sole SQLite writer; deadlines/unknown commits preserve identical-intent replay.
Do not raise the worker heap limit or widen unrelated command limits.

Migration002 adds suites, suite_revisions and input_blobs. Composite ownership FKs
bind suites to workspace/folder, revisions to suite/workspace and current pointer
back to that exact suite revision (deferred for the atomic append). Unique suite
ordinal and immutable revision rows prevent replacement; enforce immutability at
SQL level. Index scoped suite/revision pages. Config bytes<=1MiB; input manifest<=64KiB.
Replacement guards must cover INSERT OR REPLACE, including when recursive triggers
are disabled; UPDATE/DELETE triggers alone are insufficient.
The input_blobs table records scoped id/hash/bytes and staging/published state
for future byte-publication ownership; no generic metadata-register writer is exposed.
Rebuild the existing receipts table with result_json<=2MiB, preserving its rows
and shared(scope_key,request_id) identity; namespace/settings commands remain64KiB.
Fresh/v1 reopen must preserve existing organisations, settings and receipts.

Intent hashes canonical sorted-key JSON of kind, route identity and full request.
Exclude server allocation IDs for suite/revision creation. Revision intent includes
suiteId; PATCH includes suite id. A shared receipt lookup precedes version/name/input
checks: same intent returns the original result after later edits; changed intent
conflicts even across namespace/settings/suite operation kinds. Never regenerate a
new logical request after an unknown write. All checks/writes/receipt are one short
transaction, with no file/network/engine work inside it. Receipt result includes
the original full revision; a replay cannot substitute the current revision.
Revision digest hashes canonical {engineId,configVersion,config,inputManifest};
it identifies configuration/reference content, not a comparable runtime environment.

## Editor and acceptance

The workspace links to a suite index and detail/editor. Use generated client methods,
the shared router/query-key owners and existing accessible styles/motion conventions.
Form editing and JSON editing share one lossless draft. Preserve every supported
field through toggles; invalid JSON remains editable and blocks form conversion/save.
Offer target/request/load-plan controls and structured JSON for advanced fields.
Never silently drop unknown draft fields; the shared schema rejects unsupported ones.
Scope changes retire requests/cache/drafts. Failed save preserves the draft; unknown
outcome offers identical request replay; stale version offers reload without overwrite.
Display structural preflight separately from run validation. No mock successful run
button, invented upload availability or fake result state.

Backend acceptance covers fresh/v1 reopen, two organisation scopes, wrong ownership,
foreign folders/inputs, conflicting pins, immutable history, expectedVersion races,
receipt replay/collision/rollback and full-size config/UTF8 bounds. HTTP tests exercise
real pairing/CSRF/generated routes and large save/read. Frontend tests cover generated
transport, form/JSON preservation, invalid/large input, scope/cache cancellation,
conflict/unknown replay, keyboard focus and reduced-motion behavior. Integration adds
real paired HTTP->SQLite->reload and a browser check. These do not complete R0-R4.
