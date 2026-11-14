# Documentation map

The design describes a proposed rewrite. The root README describes the current
released application until the rewrite is qualified.

| Need | Read | Authority |
| --- | --- | --- |
| Agent execution/effort | [Execution plan](execution/README.md) | Work packages, model routing, locks and context packets |
| Inspect namespace deletion | [Contract](design/lld/namespace-deletion.md), [evidence](verification/namespace-deletion.md) | Empty-only versioned removal, permanent paid identity and protected references |
| Inspect protected retention | [Contract](design/lld/protected-retention.md), [accounting](verification/retention-accounting.md) | Rules/formats, private prepaid snapshots/expiry and workspace/manual previews, Apply/progress and public API/provisional UI; [parent traversal](verification/retention-parent.md) API and provisional UI qualified; [driver availability](verification/retention-driver-state.md), [native recovery](verification/native-retention.md) |
| Inspect output settlement | [Contract](design/lld/output-settlement.md), [agent owner](verification/agent-storage-settlement.md), [HTTP](verification/agent-settlement-http.md), [backend](verification/backend-storage-settlement.md), [driver](verification/settlement-driver.md), [native](verification/native-settlement.md), [local drain](verification/settlement-barrier.md), [values](verification/settlement-values.md), [rejected funding](verification/rejected-cleanup-funding.md) | Automatic admitted/unsent reconciliation; native source/no-task recovery and public retention qualified locally |
| Inspect cleanup implementation progress | [Progress index](verification/output-retirement-progress.md) | Completed local cleanup chain, linked evidence and release limitations |
| Inspect agent crash recovery | [Evidence](verification/cleanup-agent-crash.md) | Actual container/mailbox crash and unlink-before-progress recovery; no refund |
| Inspect composed cleanup recovery | [Evidence](verification/cleanup-composed.md), [harness](../tools/qualification/native-application/retirement/README.md) | Actual HTTP/native/worker reply-loss recovery; separate hard-agent-crash evidence |
| Inspect cold runtime recovery | [Association](design/lld/runtime-association.md), [evidence](verification/runtime-association.md) | Durable exact mailbox association before deletion; composed native/crash evidence linked |
| Inspect automatic cleanup | [Driver](design/lld/output-deletion-runtime.md), [evidence](verification/cleanup-driver.md) | Bounded file/retirement turns and actual shared gateway; settlement has its own owner |
| Inspect backend cleanup reservation | [Control contract](design/lld/backend-cleanup-control.md), [evidence](verification/backend-cleanup-control.md) | Dedicated policy1 charge before new delivery and explicit legacy top-up; no refund |
| Inspect backend cleanup ACK storage | [ACK contract](design/lld/backend-retirement-ack.md), [evidence](verification/backend-retirement-ack.md) | Immutable exact metadata and guarded insertion; driver/native composition linked |
| Inspect cleanup runner calls | [Gateway contract](design/lld/retirement-gateway.md), [evidence](verification/retirement-gateway.md) | Shared bounded original HTTP and exact request-bound replies; no scheduler/ACK/refund |
| Inspect backend cleanup requests | [Request projection](design/lld/backend-retirement-request.md), [evidence](verification/backend-retirement-request.md) | Committed retained original after all file receipts; no dispatch/ACK/refund |
| Inspect runner cleanup transport | [Transport contract](design/lld/retirement-transport.md), [evidence](verification/retirement-transport.md) | Authenticated bounded runner HTTP; later ACK/settlement evidence in the progress index |
| Scope and implementation order | [PLAN](../PLAN.md) | Work sequencing |
| UI redesign timing | [Decision012](decisions/012-ui-redesign-after-functional-rewrite.md) | Functional completion first; separate UI audit and redesign plan afterward |
| Frontend/assets/SDK choices | [Discussion](design/frontend-decisions.md) | Options and unresolved decisions |
| Audit inventory and failure coverage | [Inventory audit](verification/inventory-audit.md), [remaining packets](execution/remaining-rewrite.md) | Complete ID mapping and ordered exit conditions; no new execution evidence |
| Audit unfinished product parity | [Remaining parity](verification/functional-parity.md) | All36 inventory IDs, concrete remaining packets and acceptance gaps; separate from UI redesign |
| Inspect embedded API/agent reference | [Reference evidence](verification/embedded-reference.md) | Generated schemas, binary guide, standalone instructions and source-image asset delivery |
| Inspect implemented versus planned API routes | [Reference availability](verification/reference-availability.md) | Original runtime registration evidence and reconciled current catalogue totals |
| Inspect durable staging ownership | [Namespace](design/lld/staging-namespace.md), [evidence](verification/staging-namespace.md) | Installed/task anchors, startup gate and reserved capacity; composed cleanup has separate evidence |
| Inspect durable retirement fencing | [Contract](design/lld/producer-retirement.md), [store](verification/producer-retirement-store.md), [leases](verification/producer-gate.md), [barrier](verification/producer-retirement.md) | Immutable intent, shared leases and actual producer quiescence; native removal remains separate |
| Inspect private retirement composition | [Contract](design/lld/retirement-pipeline.md), [evidence](verification/retirement-pipeline.md) | Bounded complete native pipeline; authenticated endpoint/backend ACK remain separate |
| Inspect retirement wire values | [Contract](design/lld/retirement-wire.md), [evidence](verification/retirement-wire.md) | Closed request-bound pending/cleaned replies; private endpoint remains separate |
| Inspect durable native cleanup receipt | [Contract](design/lld/native-receipt.md), [evidence](verification/native-receipt.md) | Opaque post-close proof and Journal020 receipt; authenticated ACK/refund remain separate |
| Inspect one recoverable native removal step | [Contract](design/lld/native-removal.md), [evidence](verification/native-removal.md) | Exact reverse-plan unlink, prepared/cleaning ordering and Journal019; receipt/ACK remain separate |
| Inspect immutable cleanup-plan storage | [Contract](design/lld/cleanup-plan-store.md), [evidence](verification/cleanup-plan-store.md) | Post-close observation provenance and Journal018 metadata; unlink remains separate |
| Inspect bounded native task inventory | [Contract](design/lld/task-inventory.md), [evidence](verification/task-inventory.md) | Prepared-root observation and native refusal; persisted deletion plan remains separate |
| Inspect shared output-native custody | [Contract](design/lld/native-custody.md), [evidence](verification/native-custody.md) | Aggregate owner credits and cleanup/read exclusion; no deletion authority |
| Inspect exact retired-runtime authority | [Contract](design/lld/runtime-retirement.md), [evidence](verification/runtime-retirement.md) | Original-ID/daemon binding and removed-writer capability; native file absence remains separate |
| Plan producer retirement and cleanup | [Contract](design/lld/output-retirement.md), [packets](execution/output-retirement.md) | Proposed physical ACK, durable namespace, replay-safe settlement and dependency order |
| Inspect lifecycle/clock repair | [Repair evidence](verification/lifecycle-baseline-repair.md), [migration](design/lld/clock-reason-migration.md) | Identity races, exact stop cause, protected migration and matching components |
| Inspect native output cleanup custody | [Close-failure custody](verification/output-close-custody.md) | Sticky rejected closes retain bounded native owners and slots |
| Inspect stored history summaries | [Summary evidence](verification/run-history-summary.md) | Verified scalar projection, provenance, bounded indexing and remaining qualification |
| Inspect bounded history search | [Search evidence](verification/run-history-search.md) | Current names, scoped ID prefixes, bounded candidates and resumable indexing |
| Inspect history filters/pagination | [History query evidence](verification/run-history-query.md) | Scoped state/outcome filters, keyset order, cursor binding and linked summary/search evidence |
| Inspect dashboards | [Workspace overview](verification/workspace-overview.md), [organisation overview](verification/organization-overview.md) | Scoped counts/activity and capped recent/active links; whole-organisation workspace rollups |
| Inspect observed k6 load guidance | [Load guidance](verification/load-advice.md) | Current-source drops, explicit iteration-based planning and missing-data limits |
| Inspect keyboard/context navigation | [Command search](verification/command-search.md) | Shared scoped page queries, modal lifetime/keyboard checks and honest search bounds |
| Back up and read restored history | [Runbook](recovery.md), [cold recovery](design/lld/cold-recovery.md) | Fresh-only restore, separate read-only viewer and explicit maintenance |
| Inspect cold recovery design | [Cold recovery](design/lld/cold-recovery.md), [historical decision](decisions/016-historical-restore.md) | Fresh-only history, bounded copy and independent read-only fences; [local evidence](verification/cold-recovery.md); release qualification separate |
| What exists today | [Feature inventory](current-features.md) | Source-grounded capability checklist |
| System boundaries | [HLD](design/HLD.md) | Component ownership and deployment |
| Implement a feature | [LLD index](design/LLD.md), then its owner spec | Wire formats, state and failure behavior |
| Find an implementation owner | [Module map](design/lld/module-map.md) | Source/build layout and public boundaries |
| Change a module | [Engineering rules](engineering.md) | Structure and contribution limits |
| Prove a slice works | [Verification](verification.md) | Test IDs and evidence scope |
| Inspect local foundation evidence | [Local report](verification/local-foundation.md) | Exact source, commands and outstanding qualification |
| Inspect suite summaries and history | [Suite overview](verification/suite-overview.md) | Loaded-revision configuration facts, latest retained Run and exact suite-bound history |
| Inspect persisted suite editing | [Suite authoring](verification/suite-authoring.md) | Full-size configs, immutable history, draft recovery and functional evidence limits |
| Inspect persisted input/Offer intake | [Storage intake](verification/storage-intake.md) | Lifecycle/quota/pins, journal migration, client bounds and remaining byte/runtime work |
| Inspect actual input publication | [Input publication](verification/input-publication.md) | Native files, lifecycle service, publisher/provider/Stager composition and remaining HTTP/UI work |
| Implement browser input transfer | [Byte client](design/lld/input-client.md) | Append binding, bounded full downloads, integrity and original-call ownership |
| Inspect byte-client and inventory evidence | [Input client](verification/input-client.md) | Scoped UI/client tests, compiled HTTP transfer and remaining browser work |
| Inspect connected input controls | [Input controls](verification/input-controls.md) | Session ownership, upload/download, lost-ack recovery and remaining browser proof |
| Inspect directory intake | [Directory inputs](verification/directory-inputs.md) | Bounded nested folders, sequential upload, explicit replay/skip and immutable replacement |
| Inspect run intake boundary | [Run intake](verification/run-intake.md) | Reviewed command/SQLite enqueue, migration/recovery fences and remaining HTTP/dispatch work |
| Inspect authenticated run API | [Run HTTP](verification/run-http.md) | Enqueue/detail/history, real TCP lost202/restart and remaining agent work |
| Inspect executable capacity startup | [Backend startup](verification/backend-startup.md) | Actual private connection/publication, shutdown, full local gate and remaining execution work |
| Inspect backend connection components | [Private runner connection](verification/backend-connection.md) | Private config, bounded original HTTP, independent disk source and pending executable wiring |
| Inspect capacity wire/cache evidence | [Capacity sources](verification/capacity-wire.md) | Original expiry, revocation/replay, scoped and compiled checks, unresolved full-lane timing |
| Inspect integrated run controls | [Run controls](verification/run-controls.md) | Scoped run UI, agent original carrier, independent reviews and full local gate |
| Inspect collected output facts | [Output custody facts](verification/output-custody-facts.md) | Immutable private root/raw-length facts after original closes; durable source authority pending |
| Inspect source values and stopped roots | [Source values](verification/output-source-values.md) | Reviewed codecs/digest vectors and native post-close root facts; backend transfer pending |
| Inspect durable source storage | [Source Journal](verification/output-source-journal.md) | Immutable intent/source records, quota and receipt release; backend transfer pending |
| Inspect connected source collection/recovery | [Controller source](verification/controller-source-lifecycle.md) | Native file/Journal composition, exact release proof and scoped installation seams; backend publication pending |
| Inspect durable stream closure storage | [Delivery closure](verification/output-delivery-closure.md) | Journal quota, native fences and discovery; Manager/scheduler pending |
| Inspect scoped result presentation | [Result reads](verification/run-result-read.md) | Verified metadata/HTTP and scoped UI; browser/real-k6 qualification pending |
| Inspect backend artifact publication | [Output settlement](verification/output-settlement.md) | Actual native/metadata/HTTP transfer and terminal credit; real-agent qualification pending |
| Inspect shared output transport values | [Transfer values](verification/output-transfer-values.md) | Generated schemas, receipt matching and canonical range values; runtime transfer pending |
| Inspect native source HTTP | [Source HTTP](verification/output-source-http.md) | Real Journal/files, authenticated source/chunk routes and bootstrap; backend adoption pending |
| Inspect backend source adoption | [Output adoption](verification/output-adoption.md) | Single payload carrier, exact source metadata and worker replay; transfer/finalization pending |
| Inspect backend native file prerequisites | [Output files](verification/output-files.md) | Shared physical custody/promotion, namespace lease and byte adapter; transfer composition pending |
| Inspect native artifact ranges | [Range evidence](verification/output-range.md) | Shared custody/lifetime, checked EOF and original IO; HTTP/adoption pending |
| Inspect comparison browser controls | [Comparison controls](verification/run-comparison-controls.md) | Bounded selection, provenance and source charts; actual browser qualification pending |
| Inspect admitted comparison reads | [Comparison service](verification/run-comparison-service.md) | Logical matching, actual worker/files, authenticated HTTP and bootstrap; browser pending |
| Inspect four-run comparison boundary | [Comparison contract](verification/run-comparison-contract.md) | Scoped DTO/client invariants; backend/browser implementation pending |
| Inspect inline report and format controls | [Report controls](verification/report-controls.md) | Verified plain text, shared read custody and safe attachments; actual browser pending |
| Inspect performance report artifacts | [Engine reports](verification/performance-reports.md) | Bounded text/CSV, admitted custody and native arm64 publication; browser pending |
| Inspect native export script files | [Script custody](verification/export-script-custody.md) | Shared streamed verification, actual builder/large file and original close/root proof; admitted job pending |
| Inspect public standalone exports | [Public export workflow](verification/public-standalone-export.md) | Durable separate jobs, shared admission/publication, authenticated download, actual offline Docker/restart and remaining installation/retention |
| Inspect independent export wire integrity | [Export job contract](verification/standalone-export-contract.md) | Separate purpose, bounded assignment/result and legacy seal compatibility; admitted lifecycle/public workflow pending |
| Inspect staged export composition | [Export operation](verification/standalone-export-operation.md) | Exact staged input/assignment and retained compile/build/native custody; public job pending |
| Inspect export build lifecycle | [Build lifetime](verification/standalone-build-lifetime.md) | Original call retention, cancellation and fixed build deadline; admitted workflow pending |
| Inspect standalone script construction | [Engine export](verification/standalone-export.md) | Actual compiler/builder and generated-bundle semantics; HTTP/UI/native qualification pending |
| Inspect durable deletion progress | [Deletion metadata](verification/output-deletion-store.md) | Scoped intent, exact persisted native plans, worker reopen and retained charges; runtime/producer retirement pending |
| Inspect automatic backend file deletion | [Deletion driver](verification/output-deletion-runtime.md) | Committed intent/native-plan processing, restart and retained producer charges; final retirement/refund pending |
| Inspect native published-output removal | [Deletion evidence](verification/output-deletion-native.md) | Prepared namespace-bound absence, original close/lease proof; metadata/runtime retention pending |
| Inspect retained execution disk | [Disk retention](verification/disk-retention.md) | Atomic holds, release/abort accounting and worker reply-loss replay; source/cleanup pending |
| Inspect actual agent event recovery | [Agent event seam](verification/event-agent.md) | Separate-process real HTTP/Journal ACK/prune/reopen and immutable physical authority; no engine/result claim |
| Inspect durable event transport | [Event custody](verification/event-custody.md) | Durable ingestion/ACK, lost-response recovery, independent SQL ordering oracle and remaining real-agent/result work |
| Inspect durable cancellation | [Cancellation](verification/cancellation.md) | Scoped intent, atomic fresh refusal, lost-reply custody, UI recovery, full local gate and native limits |
| Inspect automatic delivery and restart recovery | [Delivery runtime](verification/delivery-runtime.md) | Shared gateway/loops, immutable replay, real TCP/SQLite restart, full gate and remaining native/result work |
| Inspect dispatch storage and worker RPC | [Dispatch RPC](verification/dispatch-rpc.md) | Atomic claims, queue fairness, fixed original carrier, shared credits and full local verification |
| Inspect matched observation transactions | [Dispatch observation](verification/dispatch-observation.md) | Atomic ACK/projection/release, original capacity lease and pending worker/runtime wiring |
| Inspect execution storage foundation | [Execution storage](verification/execution-storage.md) | Immutable costs, ownership guards, shared quota and remaining dispatch work |
| Inspect journal/control authority foundation | [Authority foundations](verification/authority-foundations.md) | Durable UUID/quarantine, control lease, startup/wire/backend binding, crash tests and integration limits |
| Inspect backend offline/startup exclusion | [Control contract](design/lld/backend-recovery-control.md) | Exclusive backend lease complements agent gate; cold snapshot/restore still pending |
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
| Inspect per-attempt resource production | [Attempt resources](verification/attempt-resources.md) | Bounded sampled CPU/memory/PIDs, durable ordering and source closure; native accuracy/overhead pending |
| Inspect resource observations | [Resource observer](verification/resource-observation.md) | Measured/configured provenance, readiness revocation, original-call ownership and runtime limits |
| Inspect full admission evidence | [Observation publisher](verification/observation-publisher.md) | Actual resource/guard composition, independent revocation and draining writes |
| Inspect installed runtime composition | [Agent runtime](verification/agent-runtime.md) | Verified startup, actual services, capability limits and retained shutdown ownership |
| Inspect executable/provider packaging | [Agent executable](verification/agent-executable.md) | Private file intake, reviewed entrypoint, full gate and Linux arm64 fixture smoke |
| Inspect native warnings and configured VU guidance | [Warning evidence](verification/k6-warning-guidance.md) | Bounded classified artifact, single-arrival guidance and real native API/reopen proof; raw diagnostic replay remains separate |
| Inspect target artifact contract | [Shared report](verification/target-observation-contract.md) | Shared strict schema/codec and scoped target views; real-browser qualification pending |
| Inspect large bodies and target observations | [Feature evidence](verification/large-bodies-target-observations.md) | Bounded body inputs, native serialization and separately scoped target samples |
| Inspect first usable local source cut | [First-use evidence](verification/first-use.md) | Browser authoring, real k6 result/chart/history/download and remaining qualification |
| Inspect opt-in Compose installation | [Compose evidence](verification/compose-installation.md) | Real provisioning, corrected startup, native k6 result and restart; release qualification pending |
| Inspect separated frontend/backend images | [Container recipes](verification/container-recipes.md) | Native arm64 builds, authenticated proxy and synthetic stream failure/cancellation; Compose pending |
| Inspect actual agent-controlled Docker execution | [Native agent/k6](verification/native-agent-k6.md) | Real pass/fail, sealed artifacts, durable reservation release and Desktop corrections |
| Inspect public API through real k6 execution | [Native application/k6](verification/native-application-k6.md) | Actual backend/agent pass/fail, artifact credit and metadata reopen; browser/Compose pending |
| Inspect published artifact downloads | [Artifact downloads](verification/run-artifact-downloads.md) | Scoped metadata, actual native streaming and withheld-EOF evidence; [browser inventory/links](verification/run-artifact-controls.md) locally verified; browser save qualification pending |
| Inspect run execution activity | [Timeline UI](verification/run-timeline-ui.md) | Bounded recent activity and lifetime/progress checks; browser/resource production pending |
| Inspect public event replay | [Run event reads](verification/run-event-reads.md) | Scoped finite reads through actual worker/HTTP, resume and unchanged accounting |
| Inspect advisory live metric foundation | [Live snapshot contract](verification/live-metric-snapshots.md) | Publisher/mailbox and trusted agent/backend/browser components verified; [native live path](verification/native-live-metrics.md) records packaged qualification |
| Review live transport custody | [Mailbox decision](decisions/013-live-metric-mailbox-custody.md) | Private bounded mailbox; shared-root rename/unlink adapter rejected |
| Inspect retained k6 metric history | [Metric archive](verification/k6-metric-archive.md) | Streamed data/index custody and phase accounting; [history reads/chart](verification/run-metric-history.md) locally verified; live transport pending |
| Inspect recorded metric filters | [Source ranges](verification/metric-source-range.md) | UTC draft/apply/reset controls, bounded paging and retired-read ownership |
| Inspect bounded k6 duration estimates | [Distribution evidence](verification/k6-distributions.md) | Immutable windows/final histograms, numeric v2 and resource qualification limits |
| Inspect private standalone generation | [Admitted export](verification/admitted-standalone-export.md) | Native offline generation, exact replay/restart and verified script source; public jobs pending |
| Inspect rejected and source-free settlement | [Output absence](verification/output-absence.md) | Native rejected intake, immutable proof/credit and affected real-k6 control; release matrix pending |
| Inspect system stop handling | [Durable stop](verification/durable-stop.md) | First-cause attribution, urgent escalation, restart and original-write ownership |
| Inspect output monitoring | [Output guard](verification/output-guard.md) | Real filesystem sampling, freshness, launch fences and remaining native qualification |
| Inspect deadline monitoring | [Timeout guard](verification/timeout-guard.md) | Original admission budget, independent polling, clock fencing and shutdown review |
| Inspect engine image evidence | [k6 image](verification/engine-image.md) | Node24/Linux arm64 execution, cgroup settings and remaining qualification |
| Inspect fresh offline installation | [Provisioning evidence](verification/fresh-installation.md) | Actual private files/Journal/authority/loaders; Compose and first-boot qualification pending |
| Inspect ordinary source Compose | [First boot](verification/compose-first-boot.md) | Automatic loopback session, real k6/offline export, ready setup and restart; native arm64 only |
| Inspect automation client evidence | [Automation checks](verification/automation-client.md) | Actual authenticated TCP/worker commands, replay and bounded client behavior; image/CI qualification pending |
| Inspect automatic loopback sessions | [Local access](verification/local-auto-session.md) | Persisted session/revocation, actual TCP/restart and compiled token-free startup; packaged browser pending |
| Inspect automatic CLI connection | [Local connect](verification/automation-local-connect.md) | Same-origin automatic grant, strict private credentials and real TCP lost-reply recovery; image qualification pending |
| Run the optional automation client | [Automation](automation.md) | Container entrypoint, mounted credentials, request files and explicit outcome semantics |
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
