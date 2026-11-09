# Namespace and settings API boundary

Entrypoint: `index.ts`; JSON Schema 2020-12 sources: `../../api/v2`.
`apiSchemas` is a deeply frozen complete closure: API modules and runner common once.
`apiMessageSchemas` maps public names to references; `ApiTypes` is schema-derived.
`apiOperations` describes routes, UUID parameter objects, queries and status/schema names.
Run enqueue/detail/page DTOs are defined; route implementation remains separate.
See docs/design/lld/run-intake.md for pinned intent, receipt replay and queue bounds.
`createApiClient`/`createApiHttpTransport` bind descriptors; see `client/CONTEXT.md` for effects/limits.
`validateApi` validates already-parsed JSON without coercion, defaults or field removal;
success preserves the reference. Failure exposes <=16 frozen structural path/code issues.
HTTP owners bound parsing/serialization, reject accessors and apply strict response validation.

Entities include UUID/version and owner scope. Workspace rootFolderId is a real folder;
only that root may have null parent. Names/path segments are display data, never host paths.
Consumers MUST compare route/body/result ownership, every parent and page item scope,
return scoped not-found for wrong owners, and namespace cursor/cache keys by scope/query.
They MUST validate same-workspace ancestry, root identity, sibling folded-name uniqueness,
depth <=8, acyclic moves, active/pinned dependencies and transactional optimistic versions.
Version increments and safe arithmetic, uniqueness, requestId idempotency/intent conflicts and UUID equality
are semantic checks. Structural validation does not establish A01/V19/V20/V21 behavior.
Installation values are complete; supplied PATCH groups replace complete values and omitted
groups are unchanged. Organisation/workspace persist only present overrides (no nulls).
Their PATCH omissions are unchanged; null leaf/group removes overrides to inherit.
Retention is an atomic policy leaf: manual disables automated selection; enabled requires
an explicit age/count/storage rule, matched by OR. Setup MUST choose manual by default.
Effective leaves carry source; consumers MUST compute inheritance, valid source ancestry,
range/value/profile agreement and ceilings, then snapshot accepted run settings immutably.
Pool CPU millicores, RAM/output/storage/reserve bytes, PID/concurrency counts are globally
shared installation accounting, separate from per-run Budget. No scope allocates a pool.
Output/storage are soft accounting unless runtime capabilities advertise hard enforcement.
Consumers MUST reject runtime-capacity excess, enforce reserve/allocation consistency and
drain lowered ceilings without killing active work; settings PATCH never purges results.
Retention preview/apply is explicit and settings UUID/version + snapshot UUID/version bound.
Preview estimates/exclusions are page-local, <=100 candidates, <=4 protected reason groups.
Manual previews MUST be empty. Consumers MUST verify sums, unique exclusion reasons,
scope, immutable cursor/snapshot binding, expiration and settings version at every page.
Apply admits <=100 candidates per request, revalidates versions/active/pinned/referenced
protection per item and resumes bounded, idempotent cleanup after interruption.
Receipts report admission/tombstones; they never claim freed bytes or completed deletion.
Installation retention routes require installation scope; organisation routes permit only
that organisation or its workspace. Error producers use static messages and safe field paths.
