# Plan: documentation restructure

Status: active. Phases 0–2 delivered on `docs/restructure` (not yet integrated);
phase 4 started: a Starlight site in `site/` builds with valid links. Phase 3
(Penpot design) and phases 5–7 are open. The triage
below is kept as the record of where each former LLD went.
Decision: [017](../../decisions/017-documentation-structure-and-delivery.md).

## Phases

| # | Outcome | Check |
| --- | --- | --- |
| 0 | Decisions 017 and 018; LLD triage (this page) | `check:docs` |
| 1 | New folders, loose files moved, STATUS and PLAN split, links fixed, folder rules and a general prose-spacing rule in `check-docs` | `check:docs` |
| 2 | LLDs consolidated into contracts, `CONTEXT.md` and decisions; anchor stamps on `system/` | `check:docs`, typecheck unchanged |
| 3 | Site design in Penpot: home, guide, concept, reference, in-app variant | Design review |
| 4 | Starlight site in `site/`, served at `/docs` in the frontend image and as a public build | `npm run build` in `site/` (links validated) |
| 5 | Remaining user pages: troubleshooting, limits, reference | Site build |
| 6 | Diagrams and animated SVGs | Site build, reduced-motion check |
| 7 | Quality pass against the design | Review |

Phase 4 so far: `site/` has its own `package.json` and lockfile outside the root
workspace. User guides for automation, capacity and backup moved from
`docs/guides/` into the site and were rewritten for users; `docs/guides/` keeps
the development guide. Serving it from the frontend image is not done yet.

Phase 2 outcome: 16 contracts in `system/contracts/` (run lifecycle split into
lifecycle and delivery; UI LLDs became the web UI contract), module map moved to
`engineering/architecture.md`, decisions 019–028 recorded, and every `system/`
page carries reviewed anchor stamps checked by `check:docs`.

## Phase 1 moves

| From | To |
| --- | --- |
| `design/HLD.md` | `system/overview.md` |
| `STATUS.md` "Available" | `system/capabilities.md` |
| `STATUS.md` "Open work" | `plans/backlog.md` |
| `../PLAN.md` | `plans/roadmap.md` (root file removed) |
| `HISTORY.md` | `evidence/README.md` |
| `verification/*.md` | `evidence/` |
| `current-features.md` | `evidence/legacy-features.md` |
| `development.md`, `automation.md` | `guides/` |
| `installed-memory.md`, `recovery.md` | `guides/change-capacity.md`, `guides/backup-and-restore.md` |
| `engineering.md`, `engineering-exceptions.md` | `engineering/conventions.md`, `engineering/exceptions.md` |
| `verification.md` | `engineering/verification.md` |
| `execution/README.md` | `engineering/workflow.md` |
| `release-approval.md` | `engineering/release.md` |
| `design/LLD.md`, `design/lld/`, `design/frontend-decisions.md` | Phase 2: `system/contracts/`, decision 019 |

## Phase 2 triage

127 LLDs, 11,780 lines, grouped by the contract that will own them. "Fold"
means module detail moves to that module's `CONTEXT.md`; reasoning with real
rejected alternatives becomes a decision record; the rest of the content is
merged into the contract or deleted after a spot-check against the code.

| Contract in `system/contracts/` | LLDs | Lines | Disposition |
| --- | --- | --- | --- |
| `execution-protocol.md` | 9 | 879 | Merge |
| `run-lifecycle.md` | 9 | 1,019 | Merge |
| `outputs-collection.md`, `outputs-settlement.md` | 33 | 3,440 | Merge into two; fold the rest |
| `retirement.md` | 14 | 1,006 | Merge |
| `recovery.md` | 3 | 198 | Merge |
| `resources.md` | 5 | 517 | Merge |
| `installation.md` | 12 | 1,069 | Merge |
| `storage.md` | 2 | 236 | Merge |
| `results.md` | 10 | 934 | Merge |
| `exports.md` | 7 | 372 | Merge |
| `inputs.md` | 4 | 485 | Merge |
| `public-api.md` | 8 | 842 | Merge; shapes stay in generated contracts |
| `engines.md` | from `engine-catalog` | | Keep as its own contract |
| `engineering/architecture.md` | 1 | 107 | Move `module-map` |
| None | 1 | 82 | Delete `task-inventory` after spot-check |
| None (UI) | 9 | 594 | Fold into `web/` CONTEXT.md; delete with the UI redesign |

Members of each group:

- **execution:** agent-controller, agent-http, agent-runtime, backend-connection,
  engine-catalog, execution-protocol, launch-contention, runner-envelopes,
  runtime-association.
- **runs:** agent-admission-evidence, agent-scheduler, agent-stop,
  attempt-observation, cancellation, dispatch-storage, event-custody, run-intake,
  runtime-polling.
- **outputs:** agent-collection, disk-retention, native-custody,
  native-diagnostics, native-receipt, native-removal, output-absence,
  output-adoption-store, output-adoption, output-allocation,
  output-artifact-writer, output-collection-custody, output-collection-intent,
  output-deletion-runtime, output-deletion-store, output-deletion,
  output-delivery-closure, output-files, output-finalization, output-guard,
  output-payload, output-public-values, output-range, output-runtime,
  output-settlement, output-source-commit, output-source-journal, output-source,
  output-transfer-owner, output-transfer, protected-retention,
  run-artifact-downloads, staging-namespace.
- **retirement:** backend-cleanup-control, backend-retirement-ack,
  backend-retirement-request, cleanup-control, cleanup-plan-store,
  namespace-deletion, output-retirement, producer-retirement, retirement-gateway,
  retirement-pipeline, retirement-transport, retirement-wire, runtime-retirement,
  workspace-retirement.
- **recovery:** backend-recovery-control, clock-reason-migration, cold-recovery.
- **resources:** attempt-resources, capacity-wire, installed-memory-change,
  resources-observability, timeout-guard.
- **installation:** compose-first-boot, compose-installation, container-recipes,
  delivery-authority, executable-agent, fresh-installation,
  installation-controller, installation-starter, installed-identity,
  installed-providers, installer-image, k6-distributions.
- **storage:** domain-storage, local-session.
- **results:** k6-metric-archive, k6-warning-guidance, live-metric-snapshots,
  load-advice, observation-publisher, performance-reports, run-comparison,
  run-metric-history, run-result-read, target-sampling.
- **exports:** admitted-standalone-export, export-publication,
  export-script-custody, standalone-build-lifetime, standalone-export-jobs,
  standalone-export-operation, standalone-export.
- **inputs:** input-client, input-http, input-publication, request-bodies.
- **public API:** automation-client, embedded-reference, organization-settings,
  run-event-reads, run-history-query, run-history-search, run-history-summary,
  suite-authoring.
- **UI:** application-ui, command-search, input-ui, organization-overview,
  run-artifact-controls, run-result-panel, run-timeline-ui, suite-overview,
  workspace-overview.

## Risks

- Condensing 11,780 lines into about 15 contracts of at most 220 lines each is
  a three- to fivefold reduction. If a group cannot fit without losing invariants
  tests rely on, it splits into a second contract rather than dropping them.
- Codex commits on `rewrite/integration` concurrently. This work runs on
  `docs/restructure` in its own worktree; integration needs approval and a
  rebase over any documentation Codex changed meanwhile.
- Five LLDs have no inbound links: backend-recovery-control,
  live-metric-snapshots, output-range, protected-retention and run-result-panel.
  They are merged like the others, not deleted for that reason alone.
