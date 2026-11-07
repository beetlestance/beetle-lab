# Decision 001: clean rewrite with isolated execution

Status: user-approved direction; detailed defaults remain proposed in PLAN.

## Decision

Reimplement beetle-lab as a small TypeScript control application, separate execution
agent and language-independent engine wrappers. Use fresh local SQLite/files and
versioned contracts. Reimplement selected current capabilities from an explicit
inventory, rather than retain the old server, parser or history reader.

## Why

The user confirmed legacy data has been deleted, removing any import obligation.
Docker-only distribution uses separate frontend/backend/agent images on amd64 and
arm64; HTTP adapters use Fastify. Organisation/workspace/folder namespaces group
local data; settings belong in the UI with global runtime ceilings.

The current application combines unrelated responsibilities and duplicates engine
logic for export. Preserving every internal route/data shape would complicate the
new execution and storage boundaries before they are established. No old data reader or
compatibility route needs to survive in the new application.

Resource isolation needs both per-attempt limits and aggregate admission. Streaming
must remain bounded through parsing, serialization, finalization and export. Jobs
need explicit phases and observability with honest attribution. Agent readability
needs mechanical module limits plus responsibility review, not just a folder tree.

## Alternatives

Incremental in-place migration was rejected by the user because compatibility
layers would slow this rewrite and preserve unnecessary structure. A Rust/Go
control rewrite is deferred: test execution already belongs in independent
runtimes, and no measured control-layer bottleneck justifies another language.
Mandatory PostgreSQL/object storage is deferred for the local product's resource
and installation budget. In-process plugins are rejected as the default execution
boundary because jobs must have independently accountable lifecycles and limits.

## Consequences

The new release starts fresh. No v1 migration, historical rollback window or
API alias is required. Future v2 schema/image rollback remains a release concern. Current feature coverage is explicit; unsafe shell hooks
are retired. Protocol conformance, failure recovery and resource qualification
are release requirements. Additional engines and shared deployment are separate
milestones, not reasons to grow the core into a universal workflow platform.

## Review triggers

Revisit control runtime after measured CPU/RAM constraints; shared storage after
multi-instance requirements; execution backend after target-user installation
feedback; plugin protocol when a real second engine exposes missing semantics.
Keep this record short and supersede it explicitly when the decision changes.
