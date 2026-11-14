# Rewrite inventory acceptance audit

Audit baseline:21aa880. Documentation/source inspection only; no new runtime pass.
Authority: [inventory](../current-features.md), [acceptance](../verification.md).
All34 F IDs and both N IDs are mapped below. Local evidence belongs to its recorded
source/environment; this audit does not requalify it against every later change.
No complete A01–A09 or R0–R4 release acceptance is inferred.

## Product and installation

| ID | Source/evidence inspected | Closure still needed |
| --- | --- | --- |
| F01 | [Workspace overview](workspace-overview.md) | Cross-workspace overview; packaged browser |
| F02 | [Namespace handlers](../../app/src/adapters/inbound/http/namespaces/index.ts), [availability](reference-availability.md) | Three protected DELETE handlers and controls |
| F03 | [Input controls](input-controls.md), [upload](../../web/src/features/input-upload/index.tsx) | Directory intake; certify replacement via immutable inputs, not destructive overwrite |
| F04 | [Authoring](suite-authoring.md), [suite catalogue](../../web/src/features/suites/index.tsx) | Catalogue currently has name/version/revision, not target/duration/latest run |
| F05 | [Run controls](run-controls.md), [native app](native-application-k6.md) | Packaged target override/cancel and failure acceptance |
| F06 | [Filters](run-history-query.md), [scalars](run-history-summary.md), [search](run-history-search.md) | Browser/platform acceptance; preserve documented search differences |
| F07 | [Event reads](run-event-reads.md), [timeline](run-timeline-ui.md), [native diagnostics](../../engines/k6/wrapper/process/metrics.ts) | Lifecycle replay exists; native diagnostic text viewing/replay does not follow from it |
| F08 | [Native live metrics](native-live-metrics.md), [recorded metrics](run-metric-history.md) | Known-value full metric/browser/platform matrix |
| F09 | [Suite compiler](../../engines/k6/compiler/suite/requests.ts), [archive](k6-metric-archive.md) | Endpoint-name/cardinality acceptance through packaged charts |
| F10 | [Load advice](load-advice.md) | Raw warning classification and configured-executor advice |
| F11 | [Archive](k6-metric-archive.md), [result](run-result-read.md), [diagnostic reader](../../engines/k6/wrapper/process/metrics.ts) | Retained logs absent: stderr only contributes a byte count; certify snapshot/redaction/replay |
| F12 | [Delivery](delivery-runtime.md), [authority](../design/lld/delivery-authority.md), [cleanup recovery](cleanup-agent-crash.md) | Full active-delivery restart and cold-restore acceptance, not orphan guessing |
| F13 | [Comparison service](run-comparison-service.md), [controls](run-comparison-controls.md) | Browser two/four-run selection, config/environment/chart acceptance |
| F14 | [Reports](performance-reports.md), [controls](report-controls.md), [retention](native-retention.md) | Browser inline/save and full release deletion matrix |
| F15 | [Public export](public-standalone-export.md), [source Compose](compose-first-boot.md) | Packaged export failure/secret/capability and download acceptance |
| F16 | [Command search](command-search.md), [shell](../../web/src/app) | Actual keyboard/themes/viewports/accessibility matrix |
| F17 | [Embedded reference](embedded-reference.md), [availability](reference-availability.md) | Packaged docs/skill downloads and actual route-status acceptance |
| F18 | [Source Compose](compose-first-boot.md), [recipes](container-recipes.md) | Matched current source/pull installs, persistence and both architectures |
| F19 | [CI workflow](../../.github/workflows/ci.yml) | Rewrite source checks exist; container/publish still target root legacy Dockerfile |

## Engine semantics and additions

| ID | Source/evidence inspected | Closure still needed |
| --- | --- | --- |
| F20 | [Scenario compiler](../../engines/k6/compiler/scenarios.ts), [cases](../../engines/k6/test/compiler/scenarios.test.ts) | Four executors' native conformance, not compilation alone |
| F21 | Same compiler/cases; [native outcomes](k6-outcomes.md) | Both iteration executors in final packaged matrix |
| F22 | [Ramp compiler](../../engines/k6/compiler/ramp.ts), [outcome mapping](k6-outcomes.md) | Native saturation/threshold abort with explicit discovery result |
| F23 | [Scenario cases](../../engines/k6/test/compiler/scenarios.test.ts) | Native parallel/delayed scenario and graceful-stop assertions |
| F24 | [Selection cases](../../engines/k6/test/runtime/selection-readiness.test.ts) | Native weighted/per-VU/wait/jitter semantics and scope |
| F25 | [Request compiler](../../engines/k6/compiler/suite/requests.ts), [large bodies](large-bodies-target-observations.md) | Final method/template/body matrix, including negative bounds |
| F26 | [Dataset cases](../../engines/k6/test/suite/datasets.test.ts) | Packaged inline/JSON/CSV/range/token and coherent-row acceptance |
| F27 | [Secret identity](../../engines/k6/test/suite/compiler.test.ts), [runtime resolution](../../engines/k6/runtime/secrets.ts) | End-to-end mounted/env secrets and canaries across stored/exported/displayed data |
| F28 | [Assertion compiler](../../engines/k6/compiler/suite/assertions.ts), [cases](../../engines/k6/test/runtime/assertions.test.ts) | Native supported-operator and malformed-response acceptance |
| F29 | [Readiness cases](../../engines/k6/test/runtime/selection-readiness.test.ts), [outcomes](k6-outcomes.md) | Packaged readiness exhaustion/threshold failure cannot pass |
| F30 | [Outcome mapping](k6-outcomes.md), [reports](performance-reports.md) | Packaged transport/assertion/threshold/inconclusive distinctions |
| F31 | [Native sampler](large-bodies-target-observations.md), [shared target views](target-observation-contract.md) | Complete metric/null/unsupported and target-versus-engine acceptance |
| F32 | [Target schema](../../contracts/runner/v1/target-runtime-report.schema.json), [views](target-observation-contract.md) | Supported field mapping and missing/sensor variants; no fabricated values |
| F33 | [Summary implementation](../../web/src/features/runs/target-observations/summary.ts), [view evidence](target-observation-contract.md) | Packaged baseline/peak/final/cooldown and heuristic labels; legacy prose need not be copied |
| F34 | [Rejection cases](../../engines/k6/test/suite/validation.test.ts), [scope decision](../../PLAN.md) | Retired deliberately; verify shell rejection and explain deferred typed tool steps |
| N01 | [Namespace handlers](../../app/src/adapters/inbound/http/namespaces/index.ts), [settings contract](../design/lld/organization-settings.md) | Protected deletion and full cross-scope/move/cycle acceptance |
| N02 | [Settings UI](../../web/src/features/settings/index.tsx), [retention](retention-accounting.md), [parent scans](retention-parent.md) | Full inheritance/active-edit/capacity acceptance; no automatic purge or Run-pin affordance implied |

## Adversarial acceptance ledger

These are evidence entrypoints and remaining acceptance mappings, not a new pass
for every V case. The packet owner must attach exact fixtures/source/environment
before closing an ID. V14/V24 additionally require explicit applicability decisions.

| IDs | Existing evidence entrypoints | Outstanding proof |
| --- | --- | --- |
| V01,V22 | [Admission](staging-admission.md), [delivery](delivery-runtime.md) | Real shared-pool parallel/isolated pressure and no oversubscription |
| V02,V03,V04,V12 | [Delivery](delivery-runtime.md), [authority](authority-foundations.md), [native recovery](native-settlement.md) | Remaining active-delivery phases, one load stream and supported restore |
| V05,V13 | [Cancellation](cancellation.md), [durable stop](durable-stop.md), [deadline](timeout-guard.md) | Packaged race/grace/useful-progress matrix |
| V06,V07,V17 | [Agent runtime](agent-runtime.md), [engine image](engine-image.md), [resources](attempt-resources.md) | Native OOM/CPU/PIDs/descendants, accurate causes and doctor refusal |
| V08,V09 | [Metric archive](k6-metric-archive.md), [distributions](k6-distributions.md), [input bounds](storage-intake.md) | Loaded flood/slow-reader/high-cardinality memory and cancellation |
| V10,V15 | [File custody](output-files.md), [native retention](native-retention.md), [input controls](input-controls.md) | Full-disk/interrupted input/publication/delete; never repeat test side effects |
| V11,V16 | [Outcome mapper](k6-outcomes.md), [native app](native-application-k6.md) | Final invalid-result, unexpected-route and secret-canary fixtures |
| V14 | [Resource contract](../design/lld/resources-observability.md) | Audit claims: function spans cannot imply per-function RSS/CPU; no feature expansion |
| V18 | [Source first boot](compose-first-boot.md), [authority](../design/lld/delivery-authority.md) | Pull install, supported consistent backup/restore and v2 rollback |
| V19,V20 | [Namespace cases](../../app/test/domain/namespaces.test.ts), [retention](retention-parent.md), [comparison](run-comparison-service.md) | Complete wrong-org/cache/cursor/export and move-cycle matrix |
| V21 | [Settings contract](../design/lld/organization-settings.md), [retention](retention-accounting.md) | Active snapshots, lower-ceiling draining and explicit purge acceptance |
| V23,V24 | [Run HTTP](run-http.md), [resources](resource-observation.md), [capacity](capacity-wire.md) | Complete schema/response fixtures; measured idle/thermal support or explicit unsupported behavior |

## Audit limits and next action

Source inspection found concrete gaps; existing tests/reports were read, not rerun.
Historical evidence remains bounded by its original inputs. In particular the25
baseline failures recorded during cleanup-control work need exact-fixture triage;
this audit does not assert a current failure count or green full suite.

Complete implementation gaps before a frozen integrated acceptance lane, then
qualify matching release images. Use the [remaining packets](../execution/remaining-rewrite.md).
UI redesign, Playwright/mutation engines, hosted IAM and shared storage remain later.
