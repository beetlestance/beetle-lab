# Scoped run result read

Status: metadata/HTTP/UI implemented locally; connected engine/browser qualification pending.
GET /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/result
returns RunResultSnapshot: id, workspace scope, activeAttemptId, result or null.
The result schema references the existing runner EngineResult and its dependency
closure; it does not copy or reinterpret the engine result schema.

The metadata reader first resolves the current scoped Run and active attempt in
one transaction. No original/acknowledged source yet returns null; a corrupt or
contradictory stored source fails explicitly. For an adopted source, use existing
source-envelope/result verification against the retained original, then derive the
result from the sole manifest. No extra persisted result/summary body, filesystem
read or engine action. Do not expose private Journal IDs or host paths.

Register the route under the existing browser authorization/origin/scope guard.
Response serialization<=73728 bytes. Public HTTP transport retains its existing
bounded general allowance; client semantic capture also applies the result bound.
The client matches route run ID, response scope and result namespace/attempt/gen1.
The UI must additionally match its current Run.activeAttemptId and engine before
rendering, and retain no old result on a scope/run/attempt switch. A sealed result
can be displayed provisionally; only authoritative Run terminal state removes the
provisional label. Reading never marks artifact publication or terminal outcome.

Metadata exposes readonly results:RunResultReader using the existing worker.
getRunResult uses the shared two-large-original lane because its reply can exceed
64KiB. Capture/validate request and reply on both sides before original release;
map wrong scope/run to404. Queue/unavailable failures remain explicit errors.

Evidence must cover pending/null and adopted source, original ownership and bad
stored data, compiled worker reopening without duplicate bodies, authorized HTTP,
client mismatch/bounds, and UI scope/attempt switching. This contract alone proves
none of the pending route, browser, real-engine or finalization behavior.
