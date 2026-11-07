# Current feature inventory

Source baseline: `44b792c` plus the unchanged application files on this branch.
Method: read routes, runner, k6 driver and browser implementations. This records
source behavior, not a claim that every feature has release-level test evidence.

R = required in the replacement k6 release. C = intentionally changed design.
L = later scope. IDs link implementation tasks to [verification](verification.md).

## Implemented capabilities

| ID | Capability | Source owner | Rewrite |
| --- | --- | --- | --- |
| F01 | Dashboard: buckets, recent activity, live runs and summary counts | [dashboard.js](../public/js/dashboard.js) | R |
| F02 | Create/delete named buckets; configs/files/run tabs | [bucket.js](../public/js/bucket.js), [server.js](../server.js) | R: call them workspaces |
| F03 | Upload files or directory trees; overwrite/read/delete inputs; reserve run outputs | [bucket.js](../public/js/bucket.js), [server.js](../server.js) | R: validated immutable input revisions |
| F04 | Recognize runnable JSON from endpoints; show target, duration and last run | [bucket.js](../public/js/bucket.js), [api.js](../public/js/api.js) | C: explicit versioned suite schema |
| F05 | Start run from config with optional target override; stop it | [runner.js](../runner.js), [server.js](../server.js) | R |
| F06 | Durable per-config run history; filters, sort, status, duration and disk size | [runs.js](../public/js/runs.js), [server.js](../server.js) | R: indexed/paged metadata |
| F07 | Live logs/status/ticks over WebSocket; reconnect replays retained data | [run.js](../public/js/run.js), [server.js](../server.js) | C: resumable bounded event reads |
| F08 | Per-second RPS, p50/p95/p99/average latency, VUs, errors and iterations | [runner.js](../runner.js), [charts.js](../public/js/charts.js) | R |
| F09 | Per-endpoint latency and endpoint-name metric tags | [loadtest.js](../loadtest.js), [runner.js](../runner.js) | R: capped series cardinality |
| F10 | Dropped-iteration banner; parse k6 warnings and recommend VU sizing | [run.js](../public/js/run.js) | R: classify suggestions as heuristic |
| F11 | Persist ticks, logs, metadata, summary and config snapshot; replay charts | [runner.js](../runner.js), [run.js](../public/js/run.js) | R: chunked artifacts |
| F12 | Mark unfinished runs as orphaned/failed on restart | [server.js](../server.js) | C: reconcile actual execution before outcome |
| F13 | Compare up to four runs: metrics, charts, config identity and config diff | [compare.js](../public/js/compare.js) | R: cap four and show environment differences |
| F14 | Inline/standalone text report, JSON summary, metrics CSV and run deletion | [run.js](../public/js/run.js), [server.js](../server.js) | R |
| F15 | Download a standalone k6 script from a run config and payloads | [server.js](../server.js) | R: one shared compiler; no copied runtime |
| F16 | Dark/light themes, persistent shell, breadcrumbs, command search | [shell.js](../public/js/shell.js) | R: accessible and responsive |
| F17 | Built-in docs, HTTP API reference and downloadable agent skill text | [docs.js](../public/js/docs.js), [integrations.js](../public/js/integrations.js) | R: generated from owned contracts |
| F18 | Docker/Compose installation; persistent local user data | [Dockerfile](../Dockerfile), [docker-compose.yml](../docker-compose.yml) | R: separate app/agent/engine images |
| F19 | CI syntax/API tests, image smoke test and multi-architecture publishing | [ci.yml](../.github/workflows/ci.yml) | R: stronger gates in verification spec |

## k6 configuration and analysis

| ID | Capability | Source owner | Rewrite |
| --- | --- | --- | --- |
| F20 | constant-arrival-rate, ramping-arrival-rate, ramping-vus, constant-vus | [loadtest.js](../loadtest.js) `buildScenarioFromSpec` | R |
| F21 | shared-iterations and per-vu-iterations | [loadtest.js](../loadtest.js) `buildScenarioFromSpec` | R |
| F22 | ramp-until saturation discovery; threshold-driven abort | [loadtest.js](../loadtest.js) `buildRampUntilStages` | R: explicit discovery outcome |
| F23 | Multiple named scenarios with start offsets and graceful stop | [loadtest.js](../loadtest.js) | R |
| F24 | Endpoint weights, per-VU iteration counters, wait/jitter | [loadtest.js](../loadtest.js) `selectEndpoint` | R: document scope, not a global quota |
| F25 | GET/POST/PUT/PATCH/DELETE, path/query/header templates, JSON body/bodyFile | [loadtest.js](../loadtest.js) `runEndpoint` | R |
| F26 | Token selection; inline/JSON/simple CSV/range data; random/byVu selection | [loadtest.js](../loadtest.js) `loadDataSource` | R: coherent row selection and proper CSV parser |
| F27 | Environment substitution and resolved config fingerprint | [runner.js](../runner.js) `_snapshotConfig` | C: secret references; redacted snapshots |
| F28 | Exact/status-family, substring, header and limited JSONPath checks | [loadtest.js](../loadtest.js) `runChecks` | R: explicit supported operators |
| F29 | k6 thresholds; health readiness retry before execution | [loadtest.js](../loadtest.js) `setup`/`options` | R: readiness failure cannot silently pass |
| F30 | Separate transport failures from failed assertions | [runner.js](../runner.js), [run.js](../public/js/run.js) | R |
| F31 | Poll target runtime stats: heap/RSS/external memory, CPU, handles/requests | [loadtest.js](../loadtest.js) `sampleMemory` | R: optional target collector |
| F32 | Target event-loop delay, GC, heap limits, C++ heap, threadpool metrics | [loadtest.js](../loadtest.js) `sampleMemory` | R: retain unsupported/missing distinction |
| F33 | Baseline/peak/final/cooldown measurements and heuristic analysis report | [loadtest.js](../loadtest.js) `buildReport` | R: heuristics are not proof of a memory leak |
| F34 | preStart/onStart/onStop external commands, gated by env/first token | [runner.js](../runner.js) `_runHook` | C: retire shell strings; typed opt-in tool steps later |

## Deliberate corrections

- Execution completion and assertion outcome are distinct. Threshold failure must
  not appear as a passing CI result; discovery stops have separate semantics.
- Target-service memory is not the engine's memory. Add engine/process/container
  observability rather than relabeling target samples.
- No automatic v1 data migration, route aliases, theme-key aliases or compatibility
  imports. No import is needed: the sole user confirmed old data has been deleted.
- Exported scripts cannot silently omit unsupported engine capabilities or secrets.
  Export fails with a capability-specific explanation when self-containment is impossible.
- A config digest alone does not establish a comparable target, engine, dataset,
  secret version, host budget, or contention environment.

## Not implemented in the current product

Suite/case authoring UI, browser E2E execution, mutation engines, generated tests,
cron scheduling, dedicated CI CLI/JUnit output, resource admission, per-run
containers, agent pairing, SQLite, PostgreSQL, and S3 artifact adapters are new
work. R0-R4 add the core runtime/CLI/storage foundations; additional engines,
generation and shared storage are follow-on capabilities, not existing features.

## Rewrite pressure visible in source

The current server combines routing, persistence, documentation, report rendering
and an embedded duplicate k6 script. Run/compare browser modules combine templates,
network calls, state, metrics and exports. The runner mixes process lifecycle,
telemetry, aggregation, secrets and persistence; its final drain reads the entire
raw metrics file. These are ownership and memory-boundary issues; a new filename
or a TypeScript extension alone does not resolve them.

## Requested additions for the rewritten release

| ID | Capability | Owner |
| --- | --- | --- |
| N01 | Organisation -> workspace -> optional folders; scoped views and queries | [Organisation/settings LLD](design/lld/organization-settings.md) |
| N02 | UI-editable run defaults, capacity and retention with safe inheritance | [Organisation/settings LLD](design/lld/organization-settings.md) |

These are new requirements, not capabilities found in the current source. A second
user-proposed feature is deliberately unspecified until discussion after the rewrite.
