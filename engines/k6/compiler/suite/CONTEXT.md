# k6 suite compiler

Pure entrypoint `index.ts`: `compileSuite(validatedConfig,{input,digest})` composes
accepted `compileLoadPlan`; returns frozen request/data/selection/assertion/readiness
IR for both runtime and export. No I/O, ambient time/randomness, environment or
secret values. `digest(string)` is a trusted injected synchronous SHA-256 function;
encoding is validated but its implementation is trusted. Node-only `validation.ts`
exports validation, real SHA-256 and `validateAndCompileSuite(unknown,unknown)`.
Input manifest refs contain UUID, SHA-256 and actual UTF-8 bytes. Inject text,
never host paths; the adapter checks bytes/hash before parsing. Bodies explicitly
use inline JSON, JSON input or text input; text is never silently parsed as JSON.
Targets are HTTP(S) bases without credentials/query/fragment. Request paths start
with `/` and append under the base path prefix. Runtime enforces the IR safety
requirement after substitution: relative path, encoded query, header controls and
rendered length <=65536. Issues contain only fixed codes/safe paths.

Templates: literal text plus `{{data.DATASET.column}}` or `{{secret.NAME}}`.
Identifiers match common identifier grammar; prototype keys and all other brace
syntax fail. Tokens are dataset columns. Select dataset rows once per iteration
using `selectDatasetRows` and share those rows across all requests/columns.
Random selection uses an injected callback in [0,1); byVu uses (VU-1)%rowCount.
`initialSelectionState`/`selectRequest` own per-VU/scenario counters; exhausted
entries are excluded, then weights apply. Wait = durationMs + uniform integer
[0,jitterMs]; exhausted selection fails explicitly. State must remain scoped.
Assertions are closed operators with explicit required flags and transport versus
assertion failure classes. JSONPath is `$` followed by `.identifier` or `[index]`;
no predicates/wildcards/quoted keys, prototype keys, >32 segments or index >1e9.
Readiness is GET, permits secret but no iteration dataset substitutions, and fails
preparation on exhaustion. Bound = attempts*timeout +(attempts-1)*interval <=budget.
Bounds: config 1MiB/shared JSON limits (inline arrays <=4096); 64 requests/datasets/
columns, 10000 external rows/dataset, 250000 materialized cells; 8MiB/input and
32MiB loaded/expanded uses (repeated refs count again), body value nodes65536 (roots
included, keys excluded); external JSON preflight admits against remaining nodes;
cells/templates <=4096 chars, <=128 tokens; JSON depth32. Request serialization
limits: URL/header64KiB, body8MiB; runtime must enforce before allocation.
Secret refs contain name/provider/locator/optional opaque version; no value/hash.
Unversioned secret identity marks reproducibility unknown. Compiler identity pins
config/effective target/compiler/schema/engine versions/image/input manifests.
Checks: scoped Vitest engines/k6/test --maxWorkers=2; generator --check; typecheck;
ESLint. IR tests do not establish native k6 conformance.
