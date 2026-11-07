# Model routing and a common quality bar

Status: proposed routing policy. Models have not been calibrated on this rewrite.
Assignments are recommendations, not guarantees of intelligence or correctness.

## Models available in this environment

| Role | Exact model | Reasoning starting point | Assignment |
| --- | --- | --- | --- |
| Coordinator/default builder | gpt-6.1-sol | medium; high for cross-boundary reasoning | Architecture integration and normal substantive coding |
| Constrained worker | gpt-6-luna | medium | Clear fixture transformations, bounded mechanical edits/docs |
| Independent risk reviewer | gpt-6-astra | high | Ambiguous contracts, races, resource accounting, security and recovery opinions |

These roles follow [official model-selection guidance](https://developers.openai.com/api/docs/guides/model-selection):
Sol balances capability/cost, Luna serves scoped work, Astra suits demanding
reasoning. Exact availability and the four-slot limit come from current session
tools, not a universal API limit. Recheck the environment before dispatch. No dollar
or throughput promise is made; stronger reasoning does not replace test evidence.

## Safe routing

Sol owns database transactions, namespace isolation, settings precedence, state
machines, Docker control, secret boundaries, cancellation/restart and the real k6
compiler/result path. Start high on those tasks; medium on routine route/UI work
with clear contracts. Use high when coupling/ambiguity warrants it, not by default
on every sentence. Runtime versions and quality gates are the same for all models.

Luna gets only a bounded behavior with established examples and a decisive oracle:
fixture variations with independently fixed expected outcomes, documented error
copy changes, source-link/index
maintenance, or a small presentational component after its pattern is accepted.
It cannot invent contracts, choose dependencies, modify migrations, schedule jobs,
change credentials, relax gates or author an entire subsystem. Tests involving
security/lifecycle semantics stay with Sol even when the code is short.

Astra reviews specific questions with candidate diffs and independently grounded
invariants. It returns findings, uncertainty and proposed tests. It does not merge,
make policy changes or convert an opinion into approval. Use targeted review at
W01 (protocol/state), W05-W06 (capacity/lifecycle), W09-W10 (result/auth seams), and
W17 (missed failure cases). Keep at most one risk-review session active.

## Calibration before cheaper delegation

Run one small bounded packet through the same instructions on a candidate model.
Compare observable correctness, scope adherence, generated drift, review effort and
required tests. A docs-only success does not qualify Luna for lifecycle code.
Use a second coding fixture if coding delegation is proposed. Save a compact result
by task class, not a global model score; no paid external benchmark is required.

Keep the lightest model that repeatedly meets the unchanged quality bar without
excessive reviewer rewrite. One material scope/invariant failure promotes a Luna
packet to Sol or triggers re-scoping. Repeated substantive Sol failures trigger a
pause for better decomposition/context and an Astra opinion if useful. Do not
spend unlimited retries on the same failing prompt. Timeout/tool failures are
classified separately; retries are bounded and never hide failed evidence.

## Identical acceptance for every author

- Strict typecheck, lint, source-size/complexity/import-cycle rules and generated
  contract drift; no model-specific exemptions or lowered thresholds.
- Behavior/negative/failure tests for the changed boundary, plus resource evidence
  where the packet touches memory/CPU/buffers/cancellation.
- No unexplained any/casts, silent catch, fake success, hidden full materialization,
  duplicate ownership or copied runtime implementation.
- No extra scope, dependency, schema, network/credential or operational action.
- Independent review with source anchors and an explicit failure oracle, then
  seam checks on the integrated SHA. Author self-report is not evidence ownership.
- A diff-path audit and unchanged reviewed contracts. Every changed file must map
  to the packet's allowlist or a separately approved coordinator amendment.

## Review severity and disposition

Blocking: incorrect outcome, resource leak/unbounded work, missing negative proof,
wrong-org access, contract drift, unsafe credentials/process control, disabled gate,
or source outside scope. Fix before integration regardless of model used.

Nonblocking: local naming, wording or reversible presentation detail with no
contract/behavior effect. Coordinator can accept a tracked follow-up, without
calling the missing behavior complete. Reviewer disagreement is resolved by the
contract, reproduction and tests; no vote or automatic strongest-model override.

If the implementation contradicts an approved contract, fix implementation or
explicitly revise the design with its consequences. Do not let a reviewer silently
expand scope or a builder silently redefine success to meet its existing code.

## Context and tool policy

Use fresh model-specific subagents with `fork_turns: none` and explicit packet
context to avoid unrelated history/private data. Current spawn arguments include
`model` and `reasoning_effort`; exact model override requires a fresh fork in this
environment. Do not assume these tool arguments are generic shell/API configuration.
Workers do not spawn nested workers. Required ancestor/repository instructions
travel in the packet; fresh context must not mean missing operating rules. Reviewers use read-only tools when such a role
is enforceable; otherwise record the limitation and audit writes after the session.

Preloading instructions reduces drift but is not an enforcement boundary. Gates,
mutations audit, independent review and source-bound test evidence carry quality.
Keep all worker/reviewer sessions free of real .env files, credentials, live data,
private reference repositories and external service writes unless a specific task
requires separately authorized access. Synthetic fixtures use obvious dummy values.
