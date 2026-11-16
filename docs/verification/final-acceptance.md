# Final rewrite acceptance ledger

Authority: [36 product IDs](../current-features.md), [nine acceptance and24 adversarial IDs](../verification.md).
This reconciliation includes candidatecf44e96a and harnessfeb0369e. **Finite R0–R4 qualification is complete; publication/default changes remain separate.**
Earlier proofs retain their original source/platform. No new execution is claimed
by editing this ledger. “Covered” below means the listed concrete behavior has
source and recorded execution evidence; it does not mean every possible variant
was tested or that a different image has been qualified.

## Evidence policy and candidate boundary

[Public candidate72243a87](goal-qualification.md) passed twelve actual browser
phases and both-native packaged execution. [Sourceb48936d8](native-source-conformance.md)
passed full CI43793313636 and later native profiles. Sinceb489, production changes
are [workspace retirement/schema28](workspace-retirement.md) and
[system-stop classification/schema29](system-stop-classification.md), including
workspace controls. Agent/contracts/k6, dependency lock and container recipes are
unchanged. Their recorded proofs are reused; this does not requalify changed
backend/UI behavior. [Current candidate qualification](current-candidate-qualification.md) now covers
both-native CI, schema29 ARM cold recovery, known-old-reader refusal and composed
actual Chromium retirement/name-reuse checks. Public/default publication remains
separate. Earlier failed trials retain their recorded outcomes.

Deterministic cases establish boundary/race semantics; actual native execution
establishes supported Docker/k6 composition. A failure permutation does not require
an additional full native load when the invariant and unchanged native boundary
are already covered. [Integrated source evidence](integrated-acceptance.md) and
later exact-source CI are execution records; a test filename alone is not one.

## Product IDs

| ID | Concrete proof | Disposition / limit |
| --- | --- | --- |
| F01 | [Workspace](workspace-overview.md), [organisation](organization-overview.md), [browser navigation](goal-qualification.md) | Counts/activity and capped links covered; current retirement filtering has candidate CI and composed Chromium proof. |
| F02 | [Namespace deletion](namespace-deletion.md), [workspace retirement](workspace-retirement.md) | Used workspace can disappear while safety records remain; current composed packaged acceptance covered. No recursive folder deletion. |
| F03 | [Directory intake](directory-inputs.md), [input controls](input-controls.md), [browser import](goal-qualification.md) | Immutable versions, conflict/replay/path limits covered; no in-place overwrite. |
| F04 | [Authoring](suite-authoring.md), [suite overview](suite-overview.md), [browser authoring](goal-qualification.md) | Versioned JSON/form, target/schedule and exact-suite history covered. Catalogue placement belongs to redesign. |
| F05 | [Controls](run-controls.md), [browser run/cancel](goal-qualification.md), [native cancellation](active-recovery.md) | Start/override/stop, replay and reconnect covered; current system-stop cause covered by source cases and native candidate composition. |
| F06 | [Query](run-history-query.md), [search](run-history-search.md), [summary](run-history-summary.md), [browser history](goal-qualification.md) | Paged scoped history and indexed summaries covered; documented bounded search semantics retained. |
| F07 | [Event reads](run-event-reads.md), [timeline](run-timeline-ui.md), [diagnostics](native-diagnostics.md) | Durable event reconnect and sanitized final diagnostics covered. Original/live stderr is unsupported. |
| F08 | [Live](native-live-metrics.md), [recorded](run-metric-history.md), [long stream](long-stream.md) | Metric functionality and current AMD long p95193.16ms covered; earlier miss retained. |
| F09 | [Archive](k6-metric-archive.md), [repeated cardinality](bounded-repeated-load.md), [metric history](run-metric-history.md) | Request-name series, bounded cardinality, numeric/histogram and chart projections covered. |
| F10 | [Warnings](k6-warning-guidance.md), [load advice](load-advice.md), [UI cases](../../web/src/features/runs/load-advice/model.test.ts) | Native insufficient-VU artifact plus bounded classifier/UI cases; heuristic guidance, no automatic capacity change. |
| F11 | [Durable results](run-result-read.md), [diagnostics](native-diagnostics.md), [secrets](native-secrets.md) | Hash-bound result/config references, numeric replay and sanitized history covered; no raw stderr replay. |
| F12 | [Both-native active recovery](active-recovery.md), [cold history](packaged-cold-recovery.md), [delivery](delivery-runtime.md) | Reconcile original execution and preserve charge, never restart load on uncertainty. Schema29 ARM cold recovery and both-native candidate active recovery covered. |
| F13 | [Comparison service](run-comparison-service.md), [four charts](../../web/src/features/runs/comparison/integration.test.tsx), [browser comparison](goal-qualification.md) | Four-run cap, provenance/config differences and explicit missing values covered. |
| F14 | [Reports](performance-reports.md), [retention](native-retention.md), [browser downloads/deletion](goal-qualification.md) | Text/JSON/CSV, hashes and protected Run deletion covered. |
| F15 | [Standalone export](public-standalone-export.md), [browser export](goal-qualification.md) | Shared compiler and capability-specific refusal covered; no silent secret/feature omission. |
| F16 | [Browser interactions](browser-interactions.md), [command search](command-search.md) | Keyboard, light/dark/system, reduced motion and three viewports covered; no accessibility certification. |
| F17 | [Reference](embedded-reference.md), [four actual downloads](browser-reference.md), [availability](reference-availability.md) | Generated contracts/assets and inspected registered operations covered; no model integration claim. |
| F18 | [Source first boot](compose-first-boot.md), [public native install](goal-qualification.md), [cold recovery](packaged-cold-recovery.md) | Fresh source/pull and persistence covered at recorded identities; schema29 candidate CI and ARM cold proof covered. |
| F19 | [CI/native delivery](candidate-image-ci.md), [supply chain and public installation](rewrite-image-delivery.md) | Immutable six-image pipeline covered. New candidate and default publication remain distinct. |
| F20 | [Compiler options](../../engines/k6/test/compiler/scenarios.test.ts), [ARM engine](native-engine-parity.md), [AMD profiles](native-source-conformance.md) | Four arrival/VU executors covered by option oracles and native runs. |
| F21 | Same [compiler](../../engines/k6/test/compiler/scenarios.test.ts) and [both-native profiles](native-source-conformance.md) | Shared/per-VU finite work verified by physical counts. |
| F22 | [Discovery outcomes](native-engine-parity.md), [AMD profiles](native-source-conformance.md) | Reached and exhausted outcomes covered; not a calibrated saturation guarantee. |
| F23 | [Native delayed scenarios](native-engine-parity.md), [scenario compiler](../../engines/k6/test/compiler/scenarios.test.ts) | Named parallel scenarios/start offsets and compiled graceful-stop semantics covered. |
| F24 | [Selector/readiness cases](../../engines/k6/test/runtime/selection-readiness.test.ts), [native finite counts](native-engine-parity.md) | Weighted selection, isolated per-VU counters, inclusive jitter and deadline clamp covered; no global iteration quota. |
| F25 | [Native requests/data](native-request-data.md), [large bodies](large-bodies-target-observations.md), [AMD profile](native-source-conformance.md) | Five methods, templates and immutable body sources covered. |
| F26 | [Native coherent rows](native-request-data.md), [dataset cases](../../engines/k6/test/suite/datasets.test.ts) | Inline/JSON/CSV/range and deterministic/random selection covered. |
| F27 | [Native secret resolution](native-secrets.md), [binding cases](../../engines/k6/test/secret-bindings.test.ts) | Scoped mounted/environment delivery and audited artifact/result/log-tail canaries covered; no universal leakage claim. |
| F28 | [Ten native assertion kinds](native-request-data.md), [assertion cases](../../engines/k6/test/runtime/assertions.test.ts) | Supported operators, malformed JSON and failed checks covered. |
| F29 | [SLO/discovery](native-engine-parity.md), [503→200 readiness](native-request-data.md), [exhaustion cases](../../engines/k6/test/runtime/selection-readiness.test.ts) | Preparation failure cannot silently pass; negative deadlines/transport use deterministic cases. |
| F30 | [Distinct native outcomes](native-engine-parity.md), [result mapping](k6-outcomes.md) | Transport, assertion, SLO, discovery and execution completeness remain distinct. Current system-stop fix has candidate source/native composition. |
| F31 | [32-field native sampler](native-target-runtime.md), [browser target scope](browser-target-runtime.md) | Optional target-reported values remain separate from engine enforcement. |
| F32 | [Native field/null oracle](native-target-runtime.md), [target contract](target-observation-contract.md) | Zero, absent, malformed and unsupported values covered; sensor accuracy is not asserted. |
| F33 | [Browser target rows](browser-target-runtime.md), [chronology cases](../../web/src/features/runs/target-observations/summary.test.ts) | Baseline/final/cooldown and heuristic labels covered; initial read needed manual reload, no automatic availability claim. |
| F34 | [Validation cases](../../engines/k6/test/suite/validation.test.ts), [downloaded notice](browser-reference.md) | Deliberately retired shell hooks; typed tools follow later. |
| N01 | [Namespace invariants](../../app/test/domain/namespaces.test.ts), [wrong-scope browser](browser-interactions.md), [retirement](workspace-retirement.md) | Hierarchy/isolation/cycle rejection covered; retirement candidate CI and composed Chromium proof covered. |
| N02 | [Settings cases](../../app/test/domain/settings.test.ts), [retention](retention-accounting.md), [browser settings](goal-qualification.md) | UI overrides, provenance, accepted snapshots and explicit retention covered; no silent purge. |

## Acceptance groups

| ID | Composition of concrete evidence | Disposition |
| --- | --- | --- |
| A01 | F01–F04/N01–N02 above; [workspace retirement](workspace-retirement.md) | Covered at recorded sources; changed retirement has candidate proof. |
| A02 | F05–F07/F11–F12; V02–V05/V11–V15 below | Lifecycle composition covered; changed cause/schema has current candidate proof. |
| A03 | F08–F10/F30; [flood](flood-slow-cancellation.md), [known distributions](../../engines/k6/test/aggregation/distribution-integration.test.ts) | Functional numeric/warning proof covered; current native latency target covered. |
| A04 | F13–F15; [comparison failures](../../app/test/run-comparison/failures.test.ts), [report composition](../../web/src/features/runs/performance-report/integration.test.tsx) | Four-run, environment, save/hash/download and capability-refusal composition covered. |
| A05 | F16–F19, [browser interaction](browser-interactions.md), [reference downloads](browser-reference.md) | Existing install/browser pipeline covered; new candidate CI passed; publication remains separate. |
| A06 | F20–F24, both-native engine runs plus compiled option/selector oracles | Covered without requiring a native run for every random seed. |
| A07 | F25–F29, native data/assertion/secret proofs plus negative boundary cases | Covered within documented supported schemas. |
| A08 | F31–F33, native field oracle and actual browser rows/chronology | Covered for manual-read flow; initial automatic availability limitation retained. |
| A09 | F34, strict configuration rejection and actual downloaded scope notice | Deliberate retirement covered; no shell compatibility or new tool-step feature. |

## Adversarial IDs

| ID | Concrete invariant and evidence | Disposition |
| --- | --- | --- |
| V01 | [Atomic admission](staging-admission.md), [both-native overlap/queue](native-source-conformance.md) | No simultaneous over-admission; covered. |
| V02 | [Lost PUT/restart](../../app/test/bootstrap/delivery-http.test.ts), [lost Docker start](../../agent/test/supervisor/launch.test.ts), [active native recovery](active-recovery.md) | Same original, no duplicate side effects; covered. |
| V03 | [Lifecycle boundary map](lifecycle-phase-evidence.md), [native active recovery](active-recovery.md) | Phase-bound deterministic recovery, including new preparing/prepared quarantine reopen, plus native active/cold boundaries; schema29 candidate CI and ARM cold proof covered. |
| V04 | [Unknown launch](../../agent/test/supervisor/launch.test.ts), [absence recovery](../../agent/test/installation/absence-recovery.test.ts) | Unreachable/running/unknown ownership stays fenced and charged; covered. |
| V05 | [Stop races](../../agent/test/supervisor/stop-reason.test.ts), [lost cancel reply/restart](../../app/test/bootstrap/cancellation-http.test.ts), [stalled-reader cancel](flood-slow-cancellation.md) | Fixed grace, idempotent stop and responsive ACK; current system cause has candidate source/native composition. |
| V06 | [Native CPU/OOM/PID](resource-controls.md), [cause correction](system-stop-classification.md) | Kernel controls both-native covered; changed public classification has current source/native composition. |
| V07 | [Native descendant stop](resource-controls.md), [active release](active-recovery.md) | Owned descendants stop and execution debt releases only on evidence; covered. |
| V08 | [Output flood/held reader](flood-slow-cancellation.md), [noisy stderr limit/drain](../../engines/k6/test/native-process/diagnostics.test.ts), [metric bounds](k6-metric-archive.md) | Explicit overflow, bounded writer capacity and cancel proof covered; [current four-run growth observation](repeated-memory-analysis.md) covered. |
| V09 | [Repeated cardinality](bounded-repeated-load.md), [input bounds](storage-intake.md), [numeric distributions](k6-distributions.md) | Bounded labels/input and explicit completeness/histograms covered. |
| V10 | [Bounded ENOSPC/recovery/delete replay](bounded-disk.md), [publication](output-files.md) | Actual full fixture storage, no missing published bytes, replay-safe recovery covered; host disk never filled. |
| V11 | [Exit/composition](../../engines/k6/test/attempt/composition.test.ts), [completeness](../../engines/k6/test/result/completeness.test.ts) | Exit0 without valid required files cannot pass; covered. |
| V12 | [Journal events](../../agent/test/journal/events.test.ts), [lost ACK/restart](../../app/test/bootstrap/delivery-http.test.ts) | Scope/generation, deduplication, prune and cursor ownership covered. |
| V13 | [Timeline progress](../../web/src/features/runs/timeline/projection.test.ts), [engine phases](../../engines/k6/test/attempt/phases.test.ts) | Heartbeat/repeated units never advance useful progress; covered. |
| V14 | [Observability contract](../design/lld/resources-observability.md), [scope labels](resource-observation.md) | Wall correlation only; no per-function RSS/CPU attribution feature or claim. |
| V15 | [Controller source recovery](../../agent/test/controller/source-recovery.test.ts), [compiled finalization reply loss](../../app/test/output-finalization/worker.test.ts) | Publication/source recovery does not rerun execution; covered. |
| V16 | [Strict target routes](native-request-data.md), [secret canaries](native-secrets.md) | Synthetic physical work rejects unexpected routes; audited surfaces redact/refuse secrets. No universal secrecy claim. |
| V17 | [Capability refusal](../../agent/test/bootstrap/capabilities.test.ts), [actual kernel controls](resource-controls.md) | Missing/unknown concrete guards cannot advertise support; covered. |
| V18 | [Fresh public install](goal-qualification.md), [cold history/exact resume](packaged-cold-recovery.md), [known old reader pair](source-cold-history.md) | Recorded image/schema pairs only; schema29 ARM candidate/known-old refusal covered. No mutable/in-place restore. |
| V19 | [Cursor scope cases](../../app/test/storage/run-history.test.ts), [export HTTP](../../app/test/exports/http.test.ts), [export intake](../../app/test/exports/intake.test.ts), [browser404/cache](browser-interactions.md) | Wrong-org object/cursor/export and attachment boundaries covered by scoped cases; retirement fence has candidate CI and composed browser proof. |
| V20 | [Cycle/cross-workspace cases](../../app/test/domain/namespaces.test.ts) | Reject moves atomically without partial mutation; covered. |
| V21 | [Accepted settings snapshots/draining](../../app/test/domain/settings.test.ts), [explicit retention](retention-accounting.md) | Active attempts keep snapshots, lower capacity drains, no silent purge; covered. |
| V22 | [Two-org shared/isolated native runs](native-parallel-admission.md), [AMD profiles](native-source-conformance.md) | Shared aggregate budget, overflow queue and isolation locks covered. |
| V23 | [Schema bridge cases](../../app/src/adapters/inbound/http/schema-compilers.test.ts), [API contracts](reference-availability.md) | Strict2020-12 validation and response projection covered by fixtures/source CI; no silent request coercion. |
| V24 | [Resource observations](resource-observation.md), [target missing sensors](native-target-runtime.md), [capacity contract](capacity-wire.md) | Unknown/source/freshness stays explicit; no automatic thermal readiness claim. |

## Qualification disposition

[Closeout](qualification-closeout.md) records complete finite R0–R4 acceptance
within the limits above. Independent review found no additional required behavior
missing from the composition. [Current AMD long trial](long-stream.md) passes the
unchanged250ms target; [current repeated memory](repeated-memory-analysis.md)
observes no retained RSS growth after the fixed four-run sequence. Earlier misses
remain recorded; neither result is a universal availability/performance/leak-free
guarantee. New publication/default changes remain separately authorised work.
