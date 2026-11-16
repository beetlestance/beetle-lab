# Rewrite inventory acceptance audit

Reconciled througha47697c9. Original implementation inventory baseline0514b74 is
preserved; later scoped native/browser proofs are linked below. No new test run
is claimed by this documentation reconciliation.
Authority: [inventory](../current-features.md), [acceptance](../verification.md).
All34 F IDs and both N IDs are mapped below. Local evidence belongs to its recorded
source/environment; this audit does not requalify it against every later change.
No complete A01–A09 or R0–R4 release acceptance is inferred.
The [combined local gate](integrated-acceptance.md) records bounded groups and
reviewed corrections. [Candidate qualification](goal-qualification.md) records
public72243a87 delivery and twelve actual browser phases; [interaction acceptance](browser-interactions.md)
adds23bb keyboard/theme/viewport/cache checks. Source-bound limits remain explicit.

## Product and installation

| ID | Source/evidence inspected | Closure still needed |
| --- | --- | --- |
| F01 | [Workspace overview](workspace-overview.md), [organisation overview](organization-overview.md) | [Twelve browser phases](goal-qualification.md) cover authoring/navigation; full overview count/activity matrix remains |
| F02 | [Namespace handlers](../../app/src/adapters/inbound/http/namespaces/index.ts), [availability](reference-availability.md) | [Packaged empty-folder deletion](goal-qualification.md) passed; nonempty removal stays unsupported; organisation/workspace deletion variants remain |
| F03 | [Input controls](input-controls.md), [directory intake and replacement](directory-inputs.md) | [Packaged input/directory import](goal-qualification.md) passed; overwrite/path/negative variants retain local evidence |
| F04 | [Authoring](suite-authoring.md), [configuration/history summary](suite-overview.md) | [Packaged authoring](goal-qualification.md) passed; selected summary/history variants remain; catalogue placement deferred |
| F05 | [Run controls](run-controls.md), [native app](native-application-k6.md) | [Browser execute/cancel/reconnect](goal-qualification.md) and [native active cancel](active-recovery.md) passed; override/race matrix remains |
| F06 | [Filters](run-history-query.md), [scalars](run-history-summary.md), [search](run-history-search.md), [exact suite](suite-overview.md) | [Browser history/reconnect](goal-qualification.md) passed; complete filter/search/page matrix remains; preserve documented search differences |
| F07 | [Event reads](run-event-reads.md), [timeline](run-timeline-ui.md), [sanitized diagnostics](native-diagnostics.md) | [Browser reconnect](goal-qualification.md) passed; sanitized diagnostic variants remain; original stderr/live diagnostics unsupported |
| F08 | [Native live metrics](native-live-metrics.md), [recorded metrics](run-metric-history.md) | [Browser metric/report reads](goal-qualification.md) and [three-reader short native](short-control-overhead.md) passed; [ARM V2 sustained stream plus separate final-read replay](long-stream.md) passed their scoped gates; known-value/flood/AMD long matrix remains |
| F09 | [Suite compiler](../../engines/k6/compiler/suite/requests.ts), [archive](k6-metric-archive.md) | Endpoint-name/cardinality acceptance through packaged charts |
| F10 | [Load advice](load-advice.md), [native warnings/configured guidance](k6-warning-guidance.md) | Packaged/browser/platform acceptance |
| F11 | [Archive](k6-metric-archive.md), [result](run-result-read.md), [safe diagnostic history](native-diagnostics.md) | [Browser durable replay](goal-qualification.md) passed; snapshot/secret matrix remains; raw/live limitation retained |
| F12 | [Delivery](delivery-runtime.md), [authority](../design/lld/delivery-authority.md), [cleanup recovery](cleanup-agent-crash.md), [cold recovery](cold-recovery.md) | [Both-native active recovery](active-recovery.md), [packaged historical restore](packaged-cold-recovery.md) passed; other phases remain |
| F13 | [Comparison service](run-comparison-service.md), [controls](run-comparison-controls.md) | [Packaged comparison](goal-qualification.md) passed its concrete selection; complete four-run/environment/chart matrix remains |
| F14 | [Reports](performance-reports.md), [controls](report-controls.md), [retention](native-retention.md) | [Browser reports/download/deletion](goal-qualification.md) passed; full protected deletion/failure matrix remains |
| F15 | [Public export](public-standalone-export.md), [source Compose](compose-first-boot.md) | [Browser export](goal-qualification.md) and both-native packaged export passed; failure/secret/capability variants remain |
| F16 | [Command search](command-search.md), [shell](../../web/src/app) | [Actual keyboard/themes/reduced motion/three viewports](browser-interactions.md) passed; not full accessibility certification |
| F17 | [Embedded reference](embedded-reference.md), [availability](reference-availability.md) | [Actual ARM reference/four downloads/HTTP hashes](browser-reference.md) passed; full operation availability and AMD browser variants remain |
| F18 | [Source Compose](compose-first-boot.md), [recipes](container-recipes.md), [historical restore](cold-recovery.md) | [Both-native public install](goal-qualification.md), [default-UID ARM/AMD history recovery](packaged-cold-recovery.md) passed; future V2 installation/rollback remains |
| F19 | [CI workflow](../../.github/workflows/ci.yml) | [Separate six-image CI/delivery](rewrite-image-delivery.md) and immutable public installer passed both architectures; legacy/default tags preserved |

## Engine semantics and additions

| ID | Source/evidence inspected | Closure still needed |
| --- | --- | --- |
| F20 | [Scenario compiler](../../engines/k6/compiler/scenarios.ts), [cases](../../engines/k6/test/compiler/scenarios.test.ts) | [Six-executor ARM run](native-engine-parity.md) and [AMD finite profile](native-source-conformance.md) passed; precise timing/load-accuracy variants remain |
| F21 | Same compiler/cases; [native outcomes](k6-outcomes.md) | [ARM native shared3/per-VU6 requests](native-engine-parity.md) and [AMD executor profile](native-source-conformance.md) passed; exhaustive executor boundary matrix remains |
| F22 | [Ramp compiler](../../engines/k6/compiler/ramp.ts), [outcome mapping](k6-outcomes.md) | [ARM reached/exhausted discovery](native-engine-parity.md) and [AMD profiles](native-source-conformance.md) passed; real saturation calibration remains |
| F23 | [Scenario cases](../../engines/k6/test/compiler/scenarios.test.ts) | [Six scenarios/delayed start ARM](native-engine-parity.md) and [AMD executor profile](native-source-conformance.md) passed; graceful-stop variants remain |
| F24 | [Selection cases](../../engines/k6/test/runtime/selection-readiness.test.ts) | Native weighted/per-VU/wait/jitter semantics and scope |
| F25 | [Request compiler](../../engines/k6/compiler/suite/requests.ts), [large bodies](large-bodies-target-observations.md) | [ARM rich request/input matrix](native-request-data.md) and [AMD profile](native-source-conformance.md) passed; exhaustive negative bounds remain |
| F26 | [Dataset cases](../../engines/k6/test/suite/datasets.test.ts) | [ARM inline/JSON/CSV/range and coherent-row acceptance](native-request-data.md) and [AMD profile](native-source-conformance.md) passed; exhaustive bounds remain |
| F27 | [Secret identity](../../engines/k6/test/suite/compiler.test.ts), [runtime resolution](../../engines/k6/runtime/secrets.ts) | [ARM env/mounted delivery, scoped refusal/rebind and artifact/result/log-tail canaries](native-secrets.md) passed; AMD and wider persisted/exported/displayed surfaces remain |
| F28 | [Assertion compiler](../../engines/k6/compiler/suite/assertions.ts), [cases](../../engines/k6/test/runtime/assertions.test.ts) | [ARM all ten assertion kinds/malformed JSON](native-request-data.md) and [AMD profile](native-source-conformance.md) passed; broader negative bounds remain |
| F29 | [Readiness cases](../../engines/k6/test/runtime/selection-readiness.test.ts), [outcomes](k6-outcomes.md) | [ARM SLO](native-engine-parity.md), [retry503→200](native-request-data.md) and [AMD profiles](native-source-conformance.md) passed; readiness exhaustion negatives remain |
| F30 | [Outcome mapping](k6-outcomes.md), [reports](performance-reports.md) | [ARM distinct transport/assertion/SLO/discovery](native-engine-parity.md) and [AMD profiles](native-source-conformance.md) passed; other result failures remain |
| F31 | [Native sampler](large-bodies-target-observations.md), [shared target views](target-observation-contract.md) | Complete metric/null/unsupported and target-versus-engine acceptance |
| F32 | [Target schema](../../contracts/runner/v1/target-runtime-report.schema.json), [views](target-observation-contract.md) | Supported field mapping and missing/sensor variants; no fabricated values |
| F33 | [Summary implementation](../../web/src/features/runs/target-observations/summary.ts), [view evidence](target-observation-contract.md) | Packaged baseline/peak/final/cooldown and heuristic labels; legacy prose need not be copied |
| F34 | [Rejection cases](../../engines/k6/test/suite/validation.test.ts), [scope decision](../../PLAN.md) | Retired deliberately; verify shell rejection and explain deferred typed tool steps |
| N01 | [Namespace handlers](../../app/src/adapters/inbound/http/namespaces/index.ts), [settings contract](../design/lld/organization-settings.md) | [Packaged empty-folder delete](goal-qualification.md), [browser wrong-scope/cache404](browser-interactions.md) passed; full move/cursor/export matrix remains |
| N02 | [Settings UI](../../web/src/features/settings/index.tsx), [retention](retention-accounting.md), [parent scans](retention-parent.md) | [Packaged settings](goal-qualification.md) passed; inheritance/active-edit/draining matrix remains; no automatic purge or Run-pin affordance implied |

## Adversarial acceptance ledger

These are evidence entrypoints and remaining acceptance mappings, not a new pass
for every V case. The packet owner must attach exact fixtures/source/environment
before closing an ID. V14/V24 additionally require explicit applicability decisions.

| IDs | Existing evidence entrypoints | Outstanding proof |
| --- | --- | --- |
| V01,V22 | [Admission](staging-admission.md), [delivery](delivery-runtime.md) | [ARM exact two-run overlap/third queued and isolated release](native-parallel-admission.md) plus [AMD profiles](native-source-conformance.md) passed; broader pressure/race variants remain |
| V02,V03,V04,V12 | [Delivery](delivery-runtime.md), [authority](authority-foundations.md), [native recovery](native-settlement.md) | [Active backend/agent recovery both-native](active-recovery.md) passed; other phases remain; [historical restore](packaged-cold-recovery.md) is separate |
| V05,V13 | [Cancellation](cancellation.md), [durable stop](durable-stop.md), [deadline](timeout-guard.md) | Packaged race/grace/useful-progress matrix |
| V06,V07,V17 | [Agent runtime](agent-runtime.md), [engine image](engine-image.md), [resources](attempt-resources.md) | [Direct kernel CPU/OOM/PID/descendant probes both-native](resource-controls.md) passed; installed-agent cause/doctor variants remain |
| V08,V09 | [Metric archive](k6-metric-archive.md), [distributions](k6-distributions.md), [input bounds](storage-intake.md) | Loaded flood/slow-reader/high-cardinality memory and cancellation |
| V10,V15 | [File custody](output-files.md), [native retention](native-retention.md), [input controls](input-controls.md) | [ARM bounded actual ENOSPC/prefix recovery/delete replay](bounded-disk.md) passed; interrupted publication/other platforms remain |
| V11,V16 | [Outcome mapper](k6-outcomes.md), [native app](native-application-k6.md) | Final invalid-result, unexpected-route and secret-canary fixtures |
| V14 | [Resource contract](../design/lld/resources-observability.md) | Audit claims: function spans cannot imply per-function RSS/CPU; no feature expansion |
| V18 | [Source first boot](compose-first-boot.md), [cold recovery](cold-recovery.md) | [Both-native public install](goal-qualification.md), [ARM/AMD default-UID historical restore/resume](packaged-cold-recovery.md) passed; [ARM source cold/foreign resume/older history reader](source-cold-history.md) passed; future-incompatible or mutable rollback remains unsupported/unproved |
| V19,V20 | [Namespace cases](../../app/test/domain/namespaces.test.ts), [retention](retention-parent.md), [comparison](run-comparison-service.md) | [Real browser wrong-org/cache404](browser-interactions.md) passed; cursor/export/full move-cycle matrix remains |
| V21 | [Settings contract](../design/lld/organization-settings.md), [retention](retention-accounting.md) | Active snapshots, lower-ceiling draining and explicit purge acceptance |
| V23,V24 | [Run HTTP](run-http.md), [resources](resource-observation.md), [capacity](capacity-wire.md) | Complete schema/response fixtures; measured idle/thermal support or explicit unsupported behavior |

## Feature-group case entrypoints

These current case paths complement the F01–F34/N01–N02 inventory above. They
identify local checks, not release acceptance for an entire A group. Integrated
results and unchanged-input reuse are recorded separately from packaged/native proof.

| Group | Concrete local case entrypoints | Remaining composed proof |
| --- | --- | --- |
| A01 | [Namespace invariants](../../app/test/domain/namespaces.test.ts), [directory upload/replay](../../web/src/features/input-directory/workflow.test.ts), [settings](../../app/test/domain/settings.test.ts) | Packaged authoring/settings/retention; N01/N02 cross-scope lifecycle |
| A02 | [Delivery loss/unknowns](../../app/test/delivery/failures.test.ts), [cancellation](../../app/test/bootstrap/cancellation-http.test.ts), [migration/replay](migration-fixtures.md) | Full active-phase native restart/cancel matrix; sanitized final diagnostics do not imply raw/live logs |
| A03 | [Known numeric distributions](../../engines/k6/test/aggregation/distribution-integration.test.ts), [warnings](../../engines/k6/test/native-process/warnings.test.ts), [safe history](native-diagnostics.md) | Packaged chart known-value checks and native flood/slow-reader qualification |
| A04 | [Comparison HTTP](../../app/test/bootstrap/run-comparison.test.ts), [four-run selection](../../web/src/features/runs/comparison/selection.test.ts), [report composition](../../web/src/features/runs/performance-report/integration.test.tsx) | Packaged save/hash/export, environment differences and deletion outcomes |
| A05 | [Reference availability](reference-availability.md), [source first boot](compose-first-boot.md), [container recipes](container-recipes.md) | [Browser interactions](browser-interactions.md), [public install/delivery](goal-qualification.md) passed their scopes; [ARM reference/download](browser-reference.md) passed; broader operation/accessibility variants remain |
| A06 | [Independent seven-executor option oracles](../../engines/k6/test/compiler/scenarios.test.ts), [native outcomes](k6-outcomes.md) | [ARM six-executor/delay/discovery](native-engine-parity.md) and [AMD profiles](native-source-conformance.md) passed; weighted/jitter/grace variants remain |
| A07 | [Unsafe config/shell rejection](../../engines/k6/test/suite/validation.test.ts), [runtime assertions](../../engines/k6/test/runtime/assertions.test.ts), [large bodies](large-bodies-target-observations.md) | [Rich ARM requests/inputs/assertions](native-request-data.md), [AMD finite profiles](native-source-conformance.md) and [ARM secret canaries](native-secrets.md) passed their scopes; exhaustion/bounds/wider leakage remain |
| A08 | [Missing/final/cooldown chronology](../../web/src/features/runs/target-observations/summary.test.ts), [scope contract](target-observation-contract.md) | Packaged target versus engine/null/sensor variants and heuristic labels |
| A09 | [Rejects scripts/shell/paths/legacy aliases without values](../../engines/k6/test/suite/validation.test.ts), [scope decision](../../PLAN.md) | [Actual reference download](browser-reference.md) verified the retired-shell notice; typed tool steps remain follow-on; this does not imply every automation operation works |

V14 applies to claims: fixed phase timing and container/process resources cannot
be described as per-function RSS/CPU. No new per-function measurement feature is
required to close that assertion. V24 must retain unknown/unsupported sensor state;
a build, CPU allocation or preferred-idle flag is not proof of thermal readiness.

## Audit limits and next action

Source inspection confirmed directory intake and diagnostic text gaps. Directory
intake and sanitized final diagnostic history now have scoped checks; reports retain
their original evidence scope. Raw/live native diagnostic replay remains unsupported.
Historical evidence remains bounded by its original inputs. The old cleanup-control
baseline failures have now been [triaged with exact fixtures](migration-fixtures.md);
this retires that recorded backlog; the [local combined gate](integrated-acceptance.md)
records subsequent full file coverage and focused corrections.

Complete implementation gaps before a frozen integrated acceptance lane, then
qualify matching release images. Use the [remaining packets](../execution/remaining-rewrite.md).
UI redesign, Playwright/mutation engines, hosted IAM and shared storage remain later.
