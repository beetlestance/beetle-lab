# Module and build ownership

Status: proposed source layout. Size/responsibility gates: [engineering](../../engineering.md).
This is the implementation navigation map, not a requirement to create empty files.
Create a module when its first behavior and tests land.

## Top-level layout

```text
app/src/
  domain/                    # Pure types, transitions and outcome rules
  application/               # One use case per module
  ports/                     # Metadata, artifacts, agent, clock, identity
  adapters/inbound/http/     # Fastify resource plugins, SSE and session handling
  client/cli/                # Optional HTTP automation client; no DB access
  adapters/outbound/sqlite/  # Storage worker, transactions and query owners
  adapters/outbound/files/   # Artifact staging/publication/reads
  adapters/outbound/runner/  # Private agent client and replay ingestion
  bootstrap/                 # API/client entrypoints and dependency wiring
agent/src/
  admission/                 # Capacity, reservation and exclusivity rules
  supervisor/                # Attempt lifecycle, cancel and reconciliation
  backends/docker/           # Approved runtime creation/inspection/termination
  backends/process/          # Later qualified process implementation
  journal/                   # Independent agent SQLite journal owner
  telemetry/                 # Resource collection and scoped sample mapping
  transport/                 # Runner API auth, schema validation and handlers
  bootstrap/
engines/k6/
  wrapper/                   # Protocol, staging and engine invocation
  compiler/                  # Pure config/data/scenario compilation
  runtime/                   # k6-only request execution/assertions/target sampling
  aggregation/               # Bounded metrics parsing and histograms
  results/                   # Outcome mapping, report and artifact seal
  export/                    # Standalone output using the same compiler
  test/
web/src/                     # Feature layout in application/UI LLD
web/Dockerfile               # Static frontend and API/SSE proxy image
contracts/
  runner/v1/                 # Language-neutral runner schemas
  api/v2/                    # Public API schemas and OpenAPI source
  engines/k6/v1/             # k6 configuration/result schemas
  fixtures/                  # Valid and invalid interoperability cases
  generated/                 # Reproducible types/validators/reference output
test/conformance/            # Fake engines and cross-boundary failures
tools/                       # Small checks/build orchestration only
docs/
```

Use a single locked JS workspace for app, agent, web and contract tooling. Each
engine owns its build recipe; a future Rust/Python engine does not become a JS
workspace dependency. Build separate frontend, backend, agent and engine images.
The backend contains API and optional automation client, no UI/browser binary/k6.
The frontend contains static files and reverse-proxy configuration, no Node server.

## Named owners

| Responsibility | Initial owner | Reads/effects |
| --- | --- | --- |
| Namespace/settings validation | app/application/organization-settings | Scoped repositories; one effective-settings resolver |
| Enqueue/cancel/retry run | app/application/*-run | Metadata port; explicit agent request/outbox |
| Container automation client | app/client/cli | Authenticated API only; no second metadata writer |
| Validate outcome eligibility/close run | app/domain/outcome | Engine result plus exit/seal evidence; no metric reinterpretation |
| Metadata transactions and pagination | app/adapters/outbound/sqlite | One worker connection owner; no engine launch |
| Artifact publication and retention | app/adapters/outbound/files | Bounded file I/O; no assertion interpretation |
| Offer reconciliation and event ingest | app/adapters/outbound/runner | Agent API, cursor and generation validation |
| Reserve/release capacity | agent/admission | Journal transaction, capability snapshot |
| Start/stop/recover attempt | agent/supervisor | Backend, journal, protocol and resource collector |
| Docker policy/flags | agent/backends/docker | Installed profile only; no browser-supplied options |
| Scoped engine resource samples | agent/telemetry | Runtime stats; no target-service interpretation |
| Compile suites and standalone scripts | engines/k6/compiler | Immutable validated inputs; pure transformation |
| Execute HTTP and assertions | engines/k6/runtime | k6 APIs; no application/agent imports |
| Aggregate raw metrics | engines/k6/aggregation | Bounded windows and histogram state |
| Render result/report | engines/k6/results | Validated summary, redacted artifacts |
| Render charts and status | web/features/runs | Generated API data only; bounded view state |

The supervisor coordinates several owners but does not implement their parsing,
SQL or report logic. A phase module returns a typed outcome and resource/progress
facts; it cannot launch sibling work outside admission. Modules do not discover
configuration or instantiate clients behind a use case's back.

## Allowed dependency edges

App inbound -> app application -> app domain/ports. App outbound implements ports;
bootstrap wires them. Agent transport -> admission/supervisor public entrypoints;
supervisor -> backend/journal/telemetry interfaces. Engines depend on their protocol
and pure compiler, never app or agent implementation. Web depends on generated API
contracts, owned features and presentation primitives.

The generated contract package has no runtime service dependency. Do not create a
catch-all shared package. Pure code is shared only when its meaning is actually
identical across owners, with direct tests; JSON lookalikes do not prove a shared
domain. Dependency/cycle checks use these edges and public entrypoints, not only
folder-name matching.

## Build and task scope

Compile app/agent TypeScript for Node separately from browser and k6 code. k6's
runtime has its own globals/type configuration; forbid accidental Node/browser
imports mechanically. Rebuild the standalone export from compiler sources rather
than storing an embedded second runtime string. Pin tools in the lockfile/build
recipes and prove generated output is unchanged on a clean build.

Feature tasks name owning modules and acceptance IDs. Examples: cancellation
changes supervisor/transition tests, not charts; a new assertion changes engine
schema/runtime/result fixtures, with generated client drift checked automatically.
A boundary change loads both owner specs; it is not a reason to read every engine.
