# Documentation map

The design describes a proposed rewrite. The root README describes the current
released application until the rewrite is qualified.

| Need | Read | Authority |
| --- | --- | --- |
| Agent execution/effort | [Execution plan](execution/README.md) | Work packages, model routing, locks and context packets |
| Scope and implementation order | [PLAN](../PLAN.md) | Work sequencing |
| Frontend/assets/SDK choices | [Discussion](design/frontend-decisions.md) | Options and unresolved decisions |
| What exists today | [Feature inventory](current-features.md) | Source-grounded capability checklist |
| System boundaries | [HLD](design/HLD.md) | Component ownership and deployment |
| Implement a feature | [LLD index](design/LLD.md), then its owner spec | Wire formats, state and failure behavior |
| Find an implementation owner | [Module map](design/lld/module-map.md) | Source/build layout and public boundaries |
| Change a module | [Engineering rules](engineering.md) | Structure and contribution limits |
| Prove a slice works | [Verification](verification.md) | Test IDs and evidence scope |
| Inspect local foundation evidence | [Local report](verification/local-foundation.md) | Exact source, commands and outstanding qualification |
| Inspect native outcome evidence | [k6 outcomes](verification/k6-outcomes.md) | Real HTTP pass/fail, seal/replay checks and their limits |
| Inspect staged wrapper evidence | [Staged k6](verification/staged-k6.md) | Real staged input, native execution, artifact publication and replay |
| Inspect agent snapshot evidence | [Agent snapshots](verification/agent-snapshots.md) | Durable lifecycle facts, pruning, restart and quota checks |
| Inspect agent control intake | [Agent control](verification/agent-control.md) | Incremental file custody, atomic checkpoints and independent correction reviews |
| Inspect controller/output integration | [Agent controller](verification/agent-controller.md) | Prepared execution wiring, sealed output custody, release and remaining installation work |
| Inspect engine image evidence | [k6 image](verification/engine-image.md) | Node24/Linux arm64 execution, cgroup settings and remaining qualification |
| Run the rewrite locally | [Development startup](development.md) | Private config, backend entrypoint and frontend dev proxy |
| Understand a settled choice | [Rewrite](decisions/001-clean-rewrite.md), [MIT license](decisions/002-mit-license.md) | Reason, scope and rejected alternative |

## Working set

For a task, read this map, the relevant HLD ownership row, one LLD, and the
specific acceptance cases. Load additional specs only across a changed boundary.
The feature inventory is needed when adding or intentionally retiring behavior.
An agent should not need the entire repository or an old conversation to implement
one task.

## Document ownership

One rule has one owning document. Other files link to it. Each authored page has
a 180-line limit; focused LLDs may use 220 lines when their contract cannot be split
cleanly. Split by responsibility, not arbitrary numbered continuations. Generated
references have their own index and never replace the authored overview.

Keep status in PLAN, design in HLD/LLDs, and evidence in CI artifacts/reports.
Keep one decision per short file; supersede it explicitly when its reasoning
changes. Close plans by preserving decisions, not by deleting their rationale.
No private-repository paths, operational data, credentials or investigation
excerpts belong in these public documents.
