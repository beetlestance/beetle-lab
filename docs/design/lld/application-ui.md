# Application, CLI and UI contracts

Status: proposed v2 API. Generated schemas own exact payload types when implemented.
Domain invariants: [storage](domain-storage.md). Engine execution: [protocol](execution-protocol.md).

## Public API

All routes below use `/api/v2`. Organisation-owned routes additionally use
`/organizations/:organizationId` before the listed path; resolve that namespace
for every lookup and query. Already explicit `/organizations/...` paths are not
prefixed again. Installation routes are listed below. JSON bodies are validated; mutation
request IDs and optimistic versions are explicit. Errors use a stable code,
message, retryable flag, request ID and safe field-level details. Never return
raw exception/config/environment values. Read lists use opaque cursor + limit.

| Routes | Owner/use case |
| --- | --- |
| GET/POST /organizations; GET/PATCH/DELETE /organizations/:id | Installation namespace administration; refuse active/pinned destructive deletion |
| GET/PATCH /settings; GET/PATCH /organizations/:id/settings | Installation and organisation settings; validated versioned updates |
| GET/POST /workspaces; GET/PATCH/DELETE /workspaces/:id | Workspace queries and mutation; refuse deletion with active runs |
| GET/POST /workspaces/:id/folders; PATCH/DELETE /folders/:id | Nested grouping; same-workspace parent and bounded acyclic moves |
| GET/PATCH /workspaces/:id/settings; POST /settings/retention-preview | Effective values, overrides and deletion preview |
| GET/POST /workspaces/:id/suites; GET/PATCH/DELETE /suites/:id | Suite index and metadata; revisions immutable |
| POST /suites/:id/revisions; GET /revisions/:id | Create schema-preflighted revision; pin scoped input metadata |
| POST /inputs; PUT /inputs/:id/chunks; POST /inputs/:id/seal | Bounded input staging, hashing and publication |
| GET /inputs/:id; DELETE /inputs/:id | Scoped metadata/streaming access; pinned inputs cannot be deleted |
| GET /engines; GET /engines/:id/schema | Installed plugin capabilities/config schema; no arbitrary image launch |
| POST /runs; GET /runs; GET /runs/:id | Idempotent enqueue, paged index, bounded detail snapshot |
| POST /runs/:id/cancel; POST /runs/:id/retry | Explicit cancel/retry intent; retry never implicit |
| GET /runs/:id/events; GET /runs/:id/samples | Resume control events; range/resolution-bounded samples |
| GET /runs/:id/attempts/:attemptId/artifacts; GET /runs/:id/attempts/:attemptId/artifacts/:artifactId/content | Verified artifacts, safe MIME/download and range reads |
| POST /runs/:id/exports; GET /exports/:id | Admitted report/CSV/script generation; query task status |
| DELETE /runs/:id; POST /comparisons | Tombstone closed run; compare at most four compatible runs |
| GET /health/live; GET /health/ready; GET /capacity | Control liveness/readiness and agent availability/budget |

Organisation CRUD, installation settings, health, capacity and installed engine
catalogue are installation routes. Input/run/artifact/export/comparison paths are
organisation-scoped. Settings do not create membership/roles in this local release.

Fastify route plugins own transport schemas, hooks and HTTP error mapping; they
never become engine plugins or SQL owners. Configure strict validators to reject
invalid fields rather than silently remove/coerce them. Compile only trusted
schemas; async namespace lookups happen after structural validation. R0 must test
JSON Schema 2020-12 request and response behavior through the chosen compiler bridge.

Status meanings: 400 malformed, 401 unpaired, 403 denied capability/origin,
404 absent, 409 stale version/conflicting intent, 413 body limit, 422 invalid
suite/capability, 429 capacity/rate deferred, 503 storage/agent unavailable.
Queueing a preflighted run returns 202 pending engine validation; show queue reason.
Expose `validationStatus: pending | passed | failed` for its pinned inputs. Full
semantic checks run under admission before target interaction; rejection becomes
durable `invalid_config`/errored/inconclusive, not a retroactive HTTP 422. See the
[validation decision](../../decisions/007-admitted-validation.md).

## Local authorization

Bind published application port to loopback. Pair a browser via a one-time local
bootstrap token and exchange for a scoped session cookie; do not put long-lived
tokens in URLs/localStorage. Apply same-origin/Host validation and CSRF protection
on mutations, including localhost. CLI uses restricted installation credential
files if the optional container client is used. Agent credentials stay backend-side.
No anonymous Docker-controlling route.
The [local session contract](local-session.md) owns pairing, cookie lifetime and guard ordering.

A public/shared server needs a separate authentication/authorization design. The
local session mechanism is not a claim of multi-user isolation. Config uploads and
engine scripts execute as trusted local user intent; document their capability.

## Live events

Use same-origin SSE for read-only events; commands remain HTTP mutations. Each
message has a durable application cursor and typed payload. Reconnect with cursor
or Last-Event-ID; deduplicate in the client. Keep server/client buffers bounded.
A slow subscriber receives a reconnect/snapshot instruction, not an unlimited queue.

Snapshot identifies last included cursor; apply only later events to avoid races.
An expired cursor requires a fresh snapshot and explicit gap/completeness state.
Transport errors, engine failure, queue wait, cancellation and stale observations
are separate UI states. Do not show a stopped stream as a successful completion.

## Browser modules

Frontend choice is delegated: React/Vite, React Router for navigation and TanStack
Query for server-state caching. Motion/interactions and reduced-motion support
are acceptance criteria. [Asset/SDK questions](../frontend-decisions.md) remain open.
A separate frontend image serves static files and proxies API/SSE to the backend. One
route registry and one query-key registry. Generate API client types/validators
from contracts, use one query/cache owner per server resource (including organisation ID), and keep transient
form/chart state in its feature. Pin library versions and compatibility at R0;
no bespoke framework spread across route modules.

```text
web/src/app/                 # Router, bootstrap, query client
web/src/features/organizations/ # Organisation selector and scoped dashboard
web/src/features/settings/   # Effective settings, overrides and retention preview
web/src/features/workspaces/ # Workspace/folders and inputs
web/src/features/suites/     # Revision editor and validation
web/src/features/runs/       # Queue, live state and history
web/src/features/compare/    # Up to four selected runs
web/src/features/artifacts/  # Report/download presentation
web/src/components/         # Shared accessible primitives
web/src/contracts/          # Generated API client, not hand-written DTOs
```

Feature entrypoints compose small components; rendering never parses raw metric
files or computes a corpus-wide comparison. Sample endpoints supply explicit
resolution, units, scope and completeness. Lazy-load routes; use stable table
geometry, accessible loading/empty/error/stale states, keyboard focus and reduced
motion. Bundle fonts/icons and verified shared assets locally after license review.

## Results, comparison and export

Compare suite/input/engine image/budget/target identity and declared target revision
when available. Warn on contention, unknown secret version, missing sampler and
incomplete results. Same suite hash alone never means an equal environment.
Charts distinguish target performance, engine resources and control-plane health.

Use one engine-owned compiler for both execution and standalone script export.
A report renders the validated result schema; no second metrics interpreter in the
web server. JSON/CSV export is streamed; heavy rendering is an admitted task with
its own attempt budget. Missing self-contained inputs or unsupported capabilities
return explicit export errors; never generate a misleading partial script.

## CLI and documentation

Docker Compose is the product entrypoint; no host-installed CLI is required.
Current `npm start`/`npm run dev` are developer scripts, not an existing product CLI.
CI starts backend + agent without frontend and calls the same authenticated HTTP
API. A small client inside the backend image may expose `validate`, `run`, `status`,
`cancel`, `compare`, `export`; it never opens a second SQLite writer or bypasses
backend ownership. Run defaults/retention are UI settings, not CLI-only policy.
Proposed optional client exit codes:
0 passed; 1 assertion/threshold failed; 2 invalid input; 3 execution/lost/artifact
error; 4 cancelled; 5 unavailable prerequisite. Discovery outcome rules are shared
with the API; no CLI-only inference. `--json` prints typed records without prose.

Generate HTTP/runner references and downloadable agent instructions from owned
contracts; keep tutorials short and separate. Test-case generation later produces
reviewable artifacts and requires an explicit execution action. Do not run generated
code automatically or place an external LLM client inside the core scheduler.
