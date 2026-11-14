# Remaining k6 rewrite packets

Baseline:4e2eba0 plus the [inventory audit](../verification/inventory-audit.md).
Scope: finish R0–R4 k6 replacement. These are completion criteria, not a claim
that each packet requires a new framework or that all existing evidence is stale.
Cleanup ACK/driver/recovery/settlement/protected retention are locally complete.
No new Goal, push, registry publication or deployment is authorised by this page.

## Functional implementation

| Packet | Inventory | Deliverable and exit condition | Dependencies |
| --- | --- | --- | --- |
| B01 namespace deletion | F02,N01 | Locally implemented empty-only routes/controls, paid markers, protected references and exact replay; [evidence](../verification/namespace-deletion.md) | Nonempty recursive maintenance is not implemented |
| B02 directory inputs | F03 | Locally implemented bounded tree intake with per-file progress, explicit conflicts/recovery and immutable replacement/pinned originals; [evidence](../verification/directory-inputs.md) | Packaged browser/platform acceptance remains; no overwrite/atomic rollback |
| B03 suite summaries | F04,F06 | Locally implemented selected-revision target/schedule facts and latest/full exact-suite history; [evidence](../verification/suite-overview.md) | Catalogue placement deferred to UI redesign/read-model design; packaged acceptance remains |
| B04 diagnostic custody | F07,F11 | Locally implemented bounded sanitized final history, explicit capture loss/redaction and verified viewing; [evidence](../verification/native-diagnostics.md) | Original stderr replay/live native diagnostics unsupported; packaged/full secret/cancel/retention acceptance remains |
| B05 warning guidance | F10 | Locally implemented bounded native warning artifact and configured single-arrival guidance; [evidence](../verification/k6-warning-guidance.md) | Independent scalar-only capture; B04 raw diagnostic replay and packaged acceptance remain separate |
| B06 organisation overview | F01 | Locally implemented whole-organisation counts/activity and capped cross-workspace recent/active links; [evidence](../verification/organization-overview.md) | Packaged browser/platform acceptance remains |
| B07 recovery tooling | F12,F18 | Locally implemented cold archive, fresh-only historical restore/viewer and exact resume; [evidence](../verification/cold-recovery.md) | Full crash/platform/source-pull qualification remains; mutable/in-place restore unsupported by ADR016 |

B01 uses explicit empty-only deletion, preserving epochs and replay identities.
Selected namespace deletion, warning guidance and dashboard/history implementation is locally complete.
Never infer cascade authority from the existence of a DELETE route.
B02–B06 have separate owners after contracts freeze; B05 captures scalar warnings
without depending on B04 raw diagnostic retention.
B07 has its own authority/state owner and must not share SQL edits with B01.
Root implements directly by default, with required independent review for dangerous
contracts. Do not spawn an idle pool. Keep one native/build/measurement lane.

## Acceptance and delivery

| Packet | Deliverable and exit condition | Depends on |
| --- | --- | --- |
| B08 acceptance closure | Map all36 F/N IDs, A01–A09 and V01–V24 to exact cases/evidence; triage historical failures and fix causes; one frozen integrated gate with honest unsupported/applicability decisions | Functional packets; audit is the starting ledger, not closure |
| B09 packaged browser/automation | Real fresh local session, authoring/inputs, execute/cancel/reconnect, metrics/history/compare/report/export/delete/settings; keyboard/themes/viewports, save/hash and cross-scope checks | Stable product and matching candidate images |
| B10 rewrite delivery pipeline | CI builds/smokes separate frontend/backend/agent/k6/export/setup images; source/pull Compose use immutable matching identities; preserve existing gates; configure scans/SBOM/license evidence | Existing recipes/source Compose; hosted execution/publication needs applicable authority |
| B11 release matrix | Native amd64/arm64 backend/agent/engines; enforced controls, bounded flood/soak, idle/loaded/telemetry overhead, disk failure and supported backup/restore/rollback; R0–R4 evidence signed off | B07–B10, actual native runners/tools |

B10 can be prepared alongside functional work; configuration does not prove hosted
execution or anonymous pull. The existing CI source-check job covers the rewrite,
but container smoke/publish still build the root legacy Dockerfile. Do not replace
the published default before the candidate passes acceptance and release gates.
Native ARM64 agent/engine with a macOS backend is valuable local evidence and does
not close a Linux-backend/AMD64 release matrix. Browser DOM checks do not close B09.

## Cost and verification discipline

Use scoped cases while implementing. Freeze relevant inputs/checks before each
integration; retain failed evidence and rerun only affected checks after corrections.
Reuse reviewed native recovery rather than repeating it for documentation changes.
B08 owns the eventual integrated full gate; a recorded old failure is not permission
to skip it or assert its current count. No new time estimate follows from this audit.

Each task records base/dirty state, contract ownership, files, source identity,
commands/exits/durations, review, limits and next ready packet. Remove its branch/
worktree after accepted local integration. Preserve user data/services and8080/8081.
No target load, external publication or user-service restart is implied.

After functional closure, separately audit and plan the full UI redesign.
Playwright, mutation testing, case generation, PostgreSQL/S3 and hosted IAM remain
R5–R7/follow-on scope; they do not block this k6 replacement release.
