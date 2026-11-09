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
| Inspect persisted suite editing | [Suite authoring](verification/suite-authoring.md) | Full-size configs, immutable history, draft recovery and functional evidence limits |
| Inspect persisted input/Offer intake | [Storage intake](verification/storage-intake.md) | Lifecycle/quota/pins, journal migration, client bounds and remaining byte/runtime work |
| Inspect actual input publication | [Input publication](verification/input-publication.md) | Native files, lifecycle service, publisher/provider/Stager composition and remaining HTTP/UI work |
| Implement browser input transfer | [Byte client](design/lld/input-client.md) | Append binding, bounded full downloads, integrity and original-call ownership |
| Inspect byte-client and inventory evidence | [Input client](verification/input-client.md) | Scoped UI/client tests, compiled HTTP transfer and remaining browser work |
| Inspect connected input controls | [Input controls](verification/input-controls.md) | Session ownership, upload/download, lost-ack recovery and remaining browser proof |
| Inspect run intake boundary | [Run intake](verification/run-intake.md) | Reviewed command/SQLite enqueue, migration/recovery fences and remaining HTTP/dispatch work |
| Inspect authenticated run API | [Run HTTP](verification/run-http.md) | Enqueue/detail/history, real TCP lost202/restart and remaining agent work |
| Inspect executable capacity startup | [Backend startup](verification/backend-startup.md) | Actual private connection/publication, shutdown, full local gate and remaining execution work |
| Inspect backend connection components | [Private runner connection](verification/backend-connection.md) | Private config, bounded original HTTP, independent disk source and pending executable wiring |
| Inspect capacity wire/cache evidence | [Capacity sources](verification/capacity-wire.md) | Original expiry, revocation/replay, scoped and compiled checks, unresolved full-lane timing |
| Inspect integrated run controls | [Run controls](verification/run-controls.md) | Scoped run UI, agent original carrier, independent reviews and full local gate |
| Inspect dispatch storage and worker RPC | [Dispatch RPC](verification/dispatch-rpc.md) | Atomic claims, queue fairness, fixed original carrier, shared credits and full local verification |
| Inspect matched observation transactions | [Dispatch observation](verification/dispatch-observation.md) | Atomic ACK/projection/release, original capacity lease and pending worker/runtime wiring |
| Inspect execution storage foundation | [Execution storage](verification/execution-storage.md) | Immutable costs, ownership guards, shared quota and remaining dispatch work |
| Inspect journal/control authority foundation | [Authority foundations](verification/authority-foundations.md) | Durable UUID/quarantine, control lease, actual startup binding, crash tests and integration limits |
| Review delivery restart/restore authority | [Delivery authority](design/lld/delivery-authority.md) | Accepted physical binding and cold restoration contract; implementation pending |
| Implement durable delivery transactions | [Dispatch storage](design/lld/dispatch-storage.md), [output allocation](design/lld/output-allocation.md) | Private port, claim/observation atomics, bounded fairness and shared storage |
| Merge agent snapshots in the backend | [Attempt observation](design/lld/attempt-observation.md) | Bounded pure identity/ordering merge before durable dispatch projection |
| Inspect admission/observation evidence | [Local evidence](verification/admission-evidence.md) | Actual journal/HTTP facts, pure backend merge, full gate and remaining SQL delivery |
| Implement admission release/refusal facts | [Agent admission evidence](design/lld/agent-admission-evidence.md) | Wire contract and required journal/HTTP proof before durable dispatch |
| Inspect shared staging admission | [Staging admission](verification/staging-admission.md) | Shared policy1 accounting, same-lease execution limits, combined local checks and remaining dispatch work |
| Inspect installed execution binding | [Installed binding](verification/installed-binding.md) | Actual descriptor pins, immutable Offer/replay, restart/shutdown fences and remaining dispatch work |
| Inspect native outcome evidence | [k6 outcomes](verification/k6-outcomes.md) | Real HTTP pass/fail, seal/replay checks and their limits |
| Inspect staged wrapper evidence | [Staged k6](verification/staged-k6.md) | Real staged input, native execution, artifact publication and replay |
| Inspect agent snapshot evidence | [Agent snapshots](verification/agent-snapshots.md) | Durable lifecycle facts, pruning, restart and quota checks |
| Inspect agent control intake | [Agent control](verification/agent-control.md) | Incremental file custody, atomic checkpoints and independent correction reviews |
| Inspect controller/output integration | [Agent controller](verification/agent-controller.md) | Prepared execution wiring, sealed output custody, release and remaining installation work |
| Inspect installation/private API | [Installation and HTTP](verification/installation-http.md) | Catalogue/admission/staging/HTTP composition, review corrections and runtime limits |
| Inspect execution scheduling | [Agent scheduler](verification/agent-scheduler.md) | Indexed active discovery, original-call bounds, fairness and shutdown evidence |
| Inspect resource observations | [Resource observer](verification/resource-observation.md) | Measured/configured provenance, readiness revocation, original-call ownership and runtime limits |
| Inspect full admission evidence | [Observation publisher](verification/observation-publisher.md) | Actual resource/guard composition, independent revocation and draining writes |
| Inspect installed runtime composition | [Agent runtime](verification/agent-runtime.md) | Verified startup, actual services, capability limits and retained shutdown ownership |
| Inspect executable/provider packaging | [Agent executable](verification/agent-executable.md) | Private file intake, reviewed entrypoint, full gate and Linux arm64 fixture smoke |
| Inspect actual agent-controlled Docker execution | [Native agent/k6](verification/native-agent-k6.md) | Real pass/fail, sealed artifacts, durable reservation release and Desktop corrections |
| Inspect system stop handling | [Durable stop](verification/durable-stop.md) | First-cause attribution, urgent escalation, restart and original-write ownership |
| Inspect output monitoring | [Output guard](verification/output-guard.md) | Real filesystem sampling, freshness, launch fences and remaining native qualification |
| Inspect deadline monitoring | [Timeout guard](verification/timeout-guard.md) | Original admission budget, independent polling, clock fencing and shutdown review |
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
