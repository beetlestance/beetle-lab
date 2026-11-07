# Engineering rules for the rewrite

Status: structural gates are implemented in `verify:v2` and configured in CI.
Local evidence does not establish a hosted CI run or release qualification.
Purpose: keep responsibilities narrow, runtime behavior bounded and task context small.

## Module ownership

One module owns one responsibility and one reason to change. Fastify plugin encapsulation scopes HTTP hooks and
schemas; framework objects stay out of domain/use cases. A supervisor manages
lifecycle; a scheduler admits capacity; a parser transforms bounded input; a store
persists it. A function that validates, starts a process, aggregates metrics and
writes reports is several responsibilities even when it is short.

Each feature directory has an index of public entrypoints and a short contract:
inputs, outputs, effects, limits, failure/cancel behavior, and focused test command.
Only public entrypoints cross feature boundaries. Composition roots may wire
adapters; domain/application modules cannot import frameworks or concrete storage.
No import cycles, deep private imports, parallel implementations or generic
`utils`/`manager` buckets. Sharing a repository does not imply sharing runtime state.

## Initial mechanical limits

| Scope | Limit | Check |
| --- | --- | --- |
| Handwritten production module | 400 physical lines | Source-size inventory; fail new oversized module |
| Function/method | 80 physical lines; cyclomatic complexity <= 10 | AST lint, excluding declared generated code |
| Function parameters | <= 5; use named input object when richer | AST lint; no hidden context bag |
| Test module | 500 lines | Split by behavior/fixture owner |
| Authored document | 180 lines; focused LLD <= 220 | Documentation check |
| Decision record | 80 lines, one decision | Documentation check |
| Feature context note | 40 lines | Own contracts and pointers only |

A line limit is a guardrail, not evidence of good design. Splitting a god function
into forwarding helpers or arbitrary numbered files does not pass review. Check
import/effect ownership as well as size. Generated schemas/clients/bundles are
excluded only through an explicit generator manifest with reproducible output and
source maps/provenance; never mark handwritten code generated to bypass a gate.

Exceptions name exact symbol, reason, owner, review date and removal condition in
the [exception registry](engineering-exceptions.md). No blanket exclusions or baseline inherited from v1.
Prefer changing the design before accepting an exception; never lower a threshold
just to pass. The first rewrite release starts with no unreviewed exceptions.

## Contracts and correctness

Strict TypeScript, no implicit any, exhaustive tagged unions, explicit unknown
validation at HTTP/config/process/storage boundaries. JSON Schema is the wire
source; generate client types and reject generated drift. Engine-native runtime
code must not import Node-only APIs accidentally. Use one pure compiler for k6
execution and export, one result mapper, one lifecycle transition owner.

Declare transaction boundaries, cancellation, timeout and retry semantics in the
owning use case. No side-effect retry under unknown outcome. Use injected clocks
and IDs for deterministic tests; do not build a generalized dependency container.
Secrets never enter default logs, fingerprints, fixtures or public evidence.

## Observability at the responsibility boundary

Every admitted job declares resource budget, phase names and progress units. Every
phase owner emits start/finish/error with attempt identity. Instrument selected
expensive operations with fixed names, wall time and work counters; no automatic
wrapper around every function and no per-call database write. Exact job CPU/RAM
comes from isolation; shared-process function measurements must state limitations.

Every collection, cache, serializer and tail buffer has an explicit limit and
failure/backpressure behavior. Test finalization and export as carefully as the
steady-state stream; a bounded read followed by full materialization is unbounded.
See the [resource contract](design/lld/resources-observability.md).

## Agent-sized work

A task changes one vertical behavior or a named boundary contract. Its handoff is:
intent, changed public interfaces, owning files, tests actually run, evidence scope
and remaining questions. An agent reads the doc map plus relevant specs, not the
entire tree or an append-only status history. Large generated logs stay in CI
artifacts; inspect summaries and failures rather than dumping full output.

Use short source files and feature-local tests so one implementation task fits a
small working set. Do not duplicate design paragraphs into code comments. Comments
explain non-obvious invariants; public adapters document effects/limits/failures.
No session names, phase numbers or private investigation details in runtime code.

## Documentation discipline

HLD owns boundaries; each LLD owns one contract; PLAN owns pending work. Decision
files own durable reasons and rejected alternatives. Verification reports own
measurements; link them instead of copying test counts into architecture docs.
When a decision is settled, preserve its reasoning in a short record. When a plan
closes, remove its work list without deleting durable rationale.

Generated references stay separate and indexed. Check internal links, page size,
required contract fields and stale API/schema output in CI. A source edit touching
an interface must update its owner spec or state explicitly that the interface
is unchanged. Use scoped tests during development and one required CI verification
for the reviewed source; no repeated heavy builds for prose changes.
