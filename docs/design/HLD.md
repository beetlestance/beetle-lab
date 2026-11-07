# High-level design

Status: proposed v2 architecture. Scope and sequence: [PLAN](../../PLAN.md).
Wire behavior is owned by the [LLD](LLD.md), not repeated here.

## Product boundary

A local-first testing workbench and headless CI client. The first rewrite release
reimplements the k6 capabilities in [the inventory](../current-features.md).
Future engines may use any language behind a versioned runner contract.

Normal installation uses Dockerfiles/Compose or pulled images, targeting
`linux/amd64` and `linux/arm64`. Native process execution is deferred. Docker Desktop
on macOS/Windows runs Linux containers; native host backends are not promised.
No promise that a subprocess is a sandbox or that a container prevents all host
interference. Users running the target on the same machine must see contention.

## Components and ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| Frontend container | Static UI, same-origin API/SSE reverse proxy, browser interactions | Engine processes, SQL, Docker, resource attribution |
| Application service | Workspaces, revisions, durable queue, public run state, result/index queries | Raw metric aggregation or container control |
| Execution agent | Capacity admission, attempt journal, supervisor, cancellation, cgroup samples | Product case editing or assertion interpretation |
| Engine wrapper | One engine invocation, phase events, parsing, bounded aggregation, result artifacts | Application metadata or sibling engine lifecycles |
| Engine executable | Actual tests and engine-native assertions | UI state or global scheduler policy |
| Artifact store | Staging, checksum, publication, paged/range reads and deletion | Test outcome inference |

Frontend, backend and agent ship as separate images. Only the frontend publishes
a loopback host port; it proxies `/api/` and SSE to the private backend. The agent
has narrowly scoped Docker access and a private authenticated API. Each attempt
uses a disposable engine container. All heavy engine-specific parsing and
report generation stay inside that attempt's budget before container teardown.
Long deferred export/generation work runs as a separately admitted task.

```text
Browser ---- Frontend static server / API-SSE proxy
                              |
                     private Backend API <---- container automation client
                         |           |
                  SQLite metadata   local artifacts
                         |
                  private runner API
                         |
                    Execution agent
                              journal / capacity / telemetry
                                          |
                            +-------------+-------------+
                         attempt A     attempt B     attempt C
                         engine image  engine image  engine image
```

## Technology choices

TypeScript strict mode for backend, agent, automation client and UI. Node.js
supported LTS and Fastify for backend/agent HTTP adapters. Fastify's schema-based
validation/serialization and scoped route plugins fit the contract boundaries.
Framework types stay in inbound adapters. Benchmark performance is not the reason
to choose it. Frontend choice is delegated: React/Vite with React Router and
TanStack Query, with reduced-motion-safe interactions. Static
frontend hosting uses a small Nginx image with a constrained reverse proxy.

JSON Schema 2020-12 is the language-neutral contract authority. Generate runtime
validators, transport types and OpenAPI 3.1 references. Fastify's default schema
dialect is not assumed to match: qualify the custom validator/response serializer
bridge and generated output at R0. Compile only trusted shipped/installed schemas;
user configs are data, never compiler source. Domain and transport models differ.

SQLite is owned by the application through one storage worker/connection owner;
the agent has a separate private journal, never a shared SQLite file. Database
work must not block the HTTP event loop. Large artifacts stay on local volumes.
Optional PostgreSQL/S3 adapters belong to a later distributed profile.

No Redis, broker, time-series server, Kubernetes, object-store service or external
observability server is required for a local install. A database outbox plus a
reconciling dispatcher is sufficient for the single application/agent profile.

## Dependency boundaries

```text
inbound HTTP -> application use cases -> domain + narrow ports
container automation client -> authenticated backend HTTP API
outbound adapters -> ports + domain
composition roots -> wire implementations
web -> generated contracts + owned view/query modules
engine wrapper -> runner protocol + engine-specific runtime
```

Application use cases have one named outcome. Ports exist for actual substitution:
metadata, artifact store, runner client, clock and identity. Avoid a port per
function and generic manager/helper modules. The agent and engine use their own
small composition roots rather than importing application storage.

## Execution flow

1. Validate a suite revision, resolve safe input identities and enqueue a run.
2. A dispatcher offers one immutable attempt to the agent with an idempotency ID.
3. The agent reserves aggregate capacity atomically or returns a queue reason.
4. The agent stages bounded inputs, starts one wrapper/container and journals it.
5. The wrapper emits phases/results; the agent measures resources independently.
6. The application ingests acknowledged event batches and serves bounded live reads.
7. The wrapper seals artifacts/result. The supervisor records stop/exit evidence.
8. The application finalizes outcome after validating the result and artifact seal.

Network timeout means unknown submission status, not permission to create another
attempt. Reconcile by immutable ID. Cancel and finalization use persisted state
transitions. Never retry test side effects automatically after uncertain execution.

## Resource and observability principles

Every active attempt has a CPU/memory/PID/time/output budget. Admission counts all
active reservations plus application/agent overhead and headroom against effective
runtime capacity, including Docker Desktop's VM rather than assumed host RAM.

Parallel runs are admitted when requested and allowed by configured budgets.
Measurement isolation is an optional mode, not a mandatory default. Idle/thermal
preferences can gate starts only using fresh supported signals; unavailable
sensors are unknown. Record actual concurrent work and measurement quality.
Container limits cap usage; quotas do not reserve cores or ensure isolation.
Measure control-stack overhead; user pool settings allocate remaining resources.
No fixed minimum-machine tier or mandatory disk allocation is a product promise.

Show target metrics, engine resources and application health as different scopes.
Job resource truth comes from the container/process tree. Function spans describe
wall duration and work, not invented per-function CPU or RSS under concurrency.
Unknown totals, unsupported sensors and sampled peaks remain labeled.

## Data and privacy

Fresh v2 data root and major-version image tags; no legacy data migration is needed.
Organisation -> workspace -> optional folders scopes every suite, input and result.
These are local namespaces, not user membership or security-tenancy claims. See
[organisation/settings](lld/organization-settings.md) for isolation and inheritance. Store redacted configuration and secret-version references,
not resolved credentials. Engines receive only run-scoped inputs/outputs. The UI
has no Docker socket. No private infrastructure dependency enters public images.

Retain files by declared quotas/retention. Publish artifact references only after
checksum verification. Artifact and metadata updates are reconciled explicitly;
there is no cross-store transaction. See [storage LLD](lld/domain-storage.md).

## Extension and deployment profiles

Built-in plugins are installed manifests plus immutable engine image digests.
Adding an engine requires conformance tests, schemas, resource profile, exit/result
mapping and documentation. No runtime marketplace or automatic plugin download.

Local: frontend + backend + agent, local SQLite/files; only frontend loopback
ingress. Users can build from source or pull matched versioned images via Compose.
CI starts backend + agent without frontend and uses the same HTTP contract through
a container-run client; no host app installation. Reports export on completion.
Shared deployments need an addendum for identity, tenancy, ownership leases,
PostgreSQL/S3 and backup/restore; their correctness is not implied by local mode.

## Deliberate exclusions

No legacy migration/rollback project, native-process backend, arbitrary DAG, cron, hosted
LLM service, mandatory metrics stack, universal mutation engine or full per-function
memory attribution. Keep the core small; add a new bounded capability only when
its execution and result contract is clear.

## Technical references

[Fastify schemas](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/),
[Fastify encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/),
[JSON Schema](https://json-schema.org/draft/2020-12),
[OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html),
[React build-tool guidance](https://react.dev/learn/build-a-react-app-from-scratch),
[React Router](https://reactrouter.com/start/declarative/installation),
[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).
