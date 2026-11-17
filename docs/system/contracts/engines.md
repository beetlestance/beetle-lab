# Engines

An engine is a trusted installed image that runs one admitted attempt inside its
container. The agent catalogue (`agent/src/catalog/`) decides which offers may reach
an engine; the agent stager writes its read-only input; the engine wrapper
(`engines/k6/wrapper/`) validates, compiles, executes, collects and seals. The
[execution protocol](execution-protocol.md) owns transport, journal and lifecycle.

## Manifest

`EngineManifest` (`contracts/runner/v1/engine-manifest.schema.json`) is installed by
an explicit trusted local action, never uploaded by a job. It owns:

| Field | Rule |
| --- | --- |
| Identity | `engineId`, `engineVersion`, `imageDigest`; protocol range exactly 1.0 |
| Schemas | Config schema URI; result schema is `engine-result` or `export-result` |
| Controls | All five of `cpu`, `memory`, `pids`, `timeout`, `output` are required at registration |
| Budgets | `defaultBudget` ≥ `minimumBudget`; both must be runtime-feasible |
| Phases | Exactly `validate`, `prepare`, `execute`, `collect`, `seal`, each with time, work and output budgets |
| Backend and network | `docker` only; network profile `none` or `target-egress` |
| Entrypoint | Executable plus at most 32 fixed arguments |
| Capabilities | At most 64 tokens, e.g. `standalone-export-v1`, `hard-output-quota` |

Images are acquired and verified before timed execution; nothing is pulled during
a measurement. At startup (`agent/src/bootstrap/installed-images.ts`) each installed
image is inspected read-only by exact local ID: environment, Linux architecture
matching the daemon, runtime and absence of inherited volumes. A missing or
mismatched image fails startup before the journal opens; there is no implicit
pull, emulation or tag selection.

## Catalogue registration

| Rule | Limit or owner |
| --- | --- |
| Installed engine/profile/config-version pins | 1–32, shared `MAX_ENGINE_PROFILES` with admission (`agent/src/admission/types.ts`) |
| Selection key | Exact `[engine.id, imageDigest, configVersion]`; ambiguity rejects |
| Shared policy | One installation ID, staging root and UID across all registrations |
| Config schema bundle | 1–16 trusted schemas, ≤ 256 KiB, root `$id` ≤ 512 characters |
| Config instance | ≤ 1 MiB, strict AJV 2020-12; no coercion, defaults or field removal |
| Validation identity | `manifestId`, `profileId`, `schemaDigest`, `catalogVersion`; `configDigest` added per Offer |

The schema digest is SHA-256 of
`beetle-lab.config-schema.v1\n<root id>\n<bundle JSON in installed order>`
(`contracts/src/engine-config/index.ts`). It is content identity, not authentication.
Arbitrary validator callbacks and remote schema resolution are not accepted.
Registration JSON is snapshotted and frozen; caller objects are not retained.
The shipped k6 adapter imports the same language-neutral schema files used by the
compiler, without importing compiler or runtime code.

## Preflight

`preflight(offer)` runs synchronously with no I/O, dataset read, secret resolution
or semantic compilation. In order:

1. Snapshot the Offer (≤ 2 MiB) and validate the runner envelope.
2. Select the installed engine by exact key; check result purpose (export offers
   need `standalone-export-v1`; ordinary offers may not require it).
3. Match `installedIdentity` against the installed entry.
4. Validate `config` against the installed schema.
5. Probe runtime feasibility on a temporary copy: budget fields below manifest
   minima are raised to the minima, and `config`, `inputs` and `secretReferences`
   are emptied. Larger budgets and every native guard stay exact, so profile maxima
   and unsupported controls still reject. A future native guard that reads an
   omitted field must amend this projection (`agent/src/catalog/offer.ts`).

The copy is never returned or persisted; admission decides the original budget.
Success means "pending admitted validation" ([decision 007](../../decisions/007-admitted-validation.md)).
Failures are fixed `CatalogError` reasons; HTTP maps `unapproved_engine` to 422
`unsupported_capability` and other catalogue failures to 422 `invalid_config`.

`resolve` is recovery-only: the persisted Offer bytes and all five validation
identity fields must equal the installed entry. It never selects a newer pin;
a missing old pin keeps the uncertain execution charged for reconciliation.

## Staged input

The stager (`agent/src/staging/`) writes under `<stagingRoot>/<runtimeName>/` only
after the matching charged reservation exists, within the
[staging allowances](../../decisions/006-agent-staging.md).

| Mount | Content |
| --- | --- |
| `/beetle/input` (read-only) | `offer.json` (≤ 2 MiB), `manifest.json` (≤ 64 KiB), `staging.json` (≤ 64 KiB, `StagedAttempt`), `input-NNN.bin` |
| `/beetle/secrets` (read-only) | One file per declared secret, ≤ 64 KiB each, ≤ 1 MiB total |
| `/beetle/output` (writable) | Fresh 0700 directory exclusively owned by the engine UID |

- Files are created 0600 with `O_EXCL|O_NOFOLLOW`, then set and verified 0400 on
  the same descriptor before fsync and close.
- Input files map one-to-one to Offer inputs, in Offer order, zero-padded indices.
- `staging.json` pins generation, intent and spec identities, exact Offer and
  manifest hashes, the absolute admitted wall deadline and staging-policy version.
  It carries no secret value or secret digest.
- Readers verify hashes, byte lengths, ownership and cross-file identity before
  executing; schema validity alone does not establish these bindings.
- The Docker adapter binds input and secrets recursively read-only; job config is
  staged, never forwarded as a Docker flag.

## Wrapper phases

| Phase | k6 owner | Work |
| --- | --- | --- |
| `validate` | `wrapper/input` | Header reads, then one `compile()`: inputs ≤ 8 MiB each / 32 MiB total, hash and UTF-8 checks, suite compilation |
| `prepare` | `build` | Bundle `suite.js` (≤ 64 MiB, plan data ≤ 24 MiB) with pinned esbuild |
| `execute` | `wrapper/process`, `wrapper/execution` | One native k6 process; starts only after the readiness marker |
| `collect` | `wrapper/execution`, `report` | Native summary (≤ 1 MiB), numeric evidence, reports (≤ 512 KiB) |
| `seal` | `wrapper/result` | Result seal per [decision 009](../../decisions/009-result-seal.md) |

- Each phase runs once. Validation completes before readiness or target load;
  validation OOM or timeout is an execution failure, not invalid configuration.
- Manifest phase budgets never extend the admitted wall and monotonic deadline,
  which includes staging and compile time.
- No phase may contain an unbounded second scheduler; independent heavy work, such
  as a standalone export, is a separately admitted task.
- The wrapper reserves the Offer output budget up front: control journal
  `clamp(total/32, 64 KiB, 64 MiB)`; numeric, warnings and diagnostics 1 MiB;
  result 64 KiB; summary 1 MiB; reports 512 KiB; optional target observations
  1 MiB; optional live mailbox `min(8 MiB, total/8)`; history a quarter of the
  remainder (≤ 256 MiB); build the rest (≤ 89 MiB). Either below 64 KiB fails
  `output_limit` (`engines/k6/wrapper/attempt/reservation.ts`).
- Cancellation sends TERM once, then KILL after 5 s, to the process group whose PID
  this wrapper spawned. The agent and Docker own hard RAM, PID and container kill.

## k6 module boundaries

| Module | Owns | Must not |
| --- | --- | --- |
| `engines/k6/plan/` | Pure plan types, deterministic selection, metric admission (≤ 200 tag maps) | Import Node, runtime or compiler values ([decision 004](../../decisions/004-engine-plan-boundary.md)) |
| `engines/k6/compiler/` | `validateLoadPlan` and pure `compileLoadPlan` | Filesystem, clock, network, process |
| `engines/k6/runtime/` | Per-VU request runtime, readiness marker `beetle_measure_started` | Raw error text in results |
| `engines/k6/build/` | The only bundler call; `suite.js` emission | Secret values |
| `engines/k6/export/` | Standalone script export over the same builder | Secret resolution; rejects declared secrets |
| `engines/k6/report/` | Text and CSV reports from mapped results | I/O, outcome inference |
| `engines/k6/wrapper/` | Lifecycle, control journal, staged input, native process, collection | Agent journal, Docker |

Config compilation, metric aggregation, report rendering and script export share
one pure compiler; no module duplicates compiler or selection logic.

## Compiler and runtime limits

| Subject | Limit |
| --- | --- |
| Load plan | 1–64 scenarios, 1–128 stages each, ≤ 128 SLO rules, ≤ 1 MiB JSON |
| Durations | Workload and offset ≤ 24 h, grace ≤ 1 h, execution ≤ 48 h |
| Load | VUs ≤ 100 000; rates ≤ 1 000 000; iterations ≤ 1e9 |
| Body processing | 1 MiB default, 8 MiB maximum, after native buffering (not a download cap; see [decision 005](../../decisions/005-native-k6-response-memory.md)) |
| Native series | ≤ 4600 per metric |
| Redirects | Disabled |

Unknown fields, JavaScript entrypoints, shell hooks, host paths and legacy aliases
fail validation. Secrets are read only from `/beetle/secrets/<declared-name>`.

## Outcome evidence

A passed result needs completed execution with a known integer exit, complete
evidence, zero failed or unknown required assertions and passing SLOs. A discovery
result passes only when its expected abort rule was reached. Exit 0 alone is never
a pass, and exit codes do not prove OOM. Missing or duplicate readiness markers make
evidence incomplete. Details: [decision 011](../../decisions/011-k6-outcome-evidence.md),
[decision 008](../../decisions/008-measurement-boundary.md) and
[decision 010](../../decisions/010-readiness-metric-isolation.md).

## Related

- [Execution protocol](execution-protocol.md)
- [Decision 004: engine plan boundary](../../decisions/004-engine-plan-boundary.md)
- [Decision 006: agent staging](../../decisions/006-agent-staging.md)
- [Decision 007: admitted validation](../../decisions/007-admitted-validation.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/runner/v1/engine-manifest.schema.json` | `a3b34c6e502d` |
| `contracts/src/engine-config/` | `0166b0b32e17` |
| `agent/src/catalog/` | `5a0a12cb7eb9` |
| `agent/src/staging/prepare.ts` | `76d5b154de34` |
| `engines/k6/wrapper/attempt/reservation.ts` | `f10b08b3c4fd` |
| `engines/k6/wrapper/lifecycle/` | `7b7190efcf46` |
