# Rewrite acceptance and evidence

Status: acceptance design. These checks are not implemented or passed merely
because this file exists. Keep current CI checks until replacements qualify.

## Required lanes

| Lane | Checks | Trigger |
| --- | --- | --- |
| Fast | Format/lint/typecheck, schema generation, imports/cycles, size/docs, unit/contract tests | Every PR |
| Integration | SQLite transactions, isolated agent/fake engine, local targets, browser mock fixtures | Behavior-changing PRs |
| Container | Image build, non-root setup, limits/cancel/restart and real k6 smoke | Execution/image changes; required release lane |
| Supply chain | Lockfile secret/dependency scan, image scan, SBOM and license inventory | Dependency/image/release changes |
| Qualification | Resource/soak/overhead, OS/backends, backup/restore | Explicit release gate; expensive lane |

Existing required check names remain until replacement jobs and branch enforcement
are verified. If a required workflow filters irrelevant work, its gate must still
report a truthful success/inapplicable result rather than disappear and block PRs.
No production targets/secrets in PR runs. Synthetic targets have explicit rate and
time caps. Use temporary directories, ports, network fixtures and fake clocks.

## Feature acceptance inventory

| Test group | Inventory IDs | Required proof |
| --- | --- | --- |
| A01 namespaces/inputs/settings | F01-F04 | Organisation/workspace/folders CRUD, scoped queries, upload paths, revision/settings validation and retention preview |
| A02 run/result lifecycle | F05-F07,F11-F12 | Queue/launch/cancel/replay/reconnect, correct terminal outcome, historical pagination |
| A03 metrics/warnings | F08-F10,F30 | Known synthetic latency/errors, bounded labels, dropped load and advisory hints |
| A04 reports/compare/export | F13-F15 | Four-run cap, environment differences, JSON/CSV/text, compiler parity, no silent omission |
| A05 UI/docs/install | F16-F19 | Keyboard/themes/viewports, generated reference, clean install, immutable image identity |
| A06 load scenarios | F20-F24 | All seven executors, delayed parallel scenarios, discovery and per-VU semantics |
| A07 requests/data/assertions | F25-F29 | Methods, payloads/templates, datasets, coherent CSV rows, secret refs, checks/readiness |
| A08 target observations | F31-F33 | Target versus engine scope, missing metrics, baseline/final/cooldown, heuristic labels |
| A09 retired hooks | F34 | Shell strings rejected; docs explain replacement scope and explicit tool capabilities |

A feature is releasable only when its required proof is attached to the tested
source. F34 is a deliberate retirement, not a claim to preserve unsafe behavior.
New engine/generation/shared-profile features get separate IDs and acceptance sets.

## Adversarial lifecycle cases

| ID | Scenario | Required observation |
| --- | --- | --- |
| V01 | Two concurrent offers cannot both fit | One atomic admission; other receives budget reason |
| V02 | Response lost after accepted start | Same attempt returns same execution, no duplicate load |
| V03 | App/agent restarted in each lifecycle phase | Reconcile exact container/generation and reservation |
| V04 | Agent unreachable while execution may run | Unknown stays charged; no speculative replacement |
| V05 | Cancel racing result/exit and repeated cancel | One monotonic terminal result; grace not reset |
| V06 | CPU busy loop, OOM, PID growth | Controls enforced where advertised; cause evidence accurate |
| V07 | Child creates descendants | All owned descendants stop; no leaked process or reservation |
| V08 | Log/metric flood and slow subscriber | Bounded RAM/spool, explicit overflow, cancel still responsive |
| V09 | High-cardinality/unbounded input | Reject/coalesce explicitly; correct completeness and histogram semantics |
| V10 | Full disk or interrupted upload/delete | No published missing artifact; recovery idempotent |
| V11 | Engine exit 0 without valid result | Inconclusive execution error, never pass |
| V12 | Stale generation or replayed events | Reject old ownership; deduplicate; preserve cursor ordering |
| V13 | Heartbeat without work | Liveness updates; useful-progress clock remains stale |
| V14 | Shared-process concurrent function spans | Wall correlation only; no false per-function RSS/CPU claims |
| V15 | Artifact failure after tests finish | Retry publication only, never repeat test side effects |
| V16 | Unexpected HTTP/mock route or secret canary | Fail fixture or redact canary; no external network escape |
| V17 | Runtime lacks advertised hard controls | Doctor rejects required profile; no silent downgrade |
| V18 | Fresh install, empty data, future v2 rollback | No legacy dependency; supported v2 image/schema rollback only |
| V19 | Wrong-org object ID/cache/cursor/export | Scoped 404/rejection; no mixed views or cross-org object attachment |
| V20 | Move folder to descendant/other workspace | Reject cycle/cross-workspace move without partial mutation |
| V21 | Settings edited during active attempts | Accepted snapshots unchanged; lower ceilings drain safely; no silent purge |
| V22 | Org A and B request parallel runs | Concurrent admission within shared budget; overflow queues; isolated mode locks correctly |
| V24 | Idle/thermal policy with stale/missing sensors | Source/freshness/unknown shown; no invented thermal readiness |
| V23 | Fastify schema/compiler bridge and response | 2020-12 fixtures validated; no silent request mutation or leaked fields |

Use fake engine fixtures for deterministic failure coverage; run real engine
conformance for supported image/backend pairs. Fake-engine success alone cannot
establish real Docker, platform or k6 behavior.

## Resource qualification

Use the fixture and proposed targets in [resources](design/lld/resources-observability.md).
Measure frontend/backend/agent/attempt scopes independently, including idle/loaded
stack overhead, user-selected pool sizes, parallel and isolated modes, telemetry off/on,
repeated runs, final drain, export, cancellation and post-run idle memory. Exercise
at least one simultaneous multi-engine case after that feature lands. Confirm
aggregate reservation accounting and headroom under pressure, not only each cap.

Qualify Linux containers for amd64 and arm64 separately, including each engine
image. Docker Desktop records VM limits/storage placement; macOS/Windows native
backends are not release targets. An architecture manifest or emulated build alone
does not prove native execution or performance. Native process-mode qualification
is deferred. Verify frontend proxy SSE/auth, private backend/agent ports, and
matched image versions in both source-build and image-pull Compose installs.

## Evidence record and stop rules

Store revision/dirty-input identity, config/schema and engine digest, tool versions,
OS/runtime/backend, requested/enforced budget, commands/exits, measurements,
artifact checksums and limitations. Use planned, locally verified, CI verified and
release qualified only for their actual evidence scope. Failed scanners or missing
prerequisites are failures/blocked, not clearance. Redact evidence before upload.

If a task exceeds its declared budget, reduce/split work or revise the reviewed
contract; never silently increase limits, disable a gate or relabel success.
Keep release rollbacks tied to image/schema/data identities. A clean rewrite
release must finish R0-R4 and their required feature/failure cases before replacing
the published default image.
