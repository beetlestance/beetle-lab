# Remaining k6 rewrite packets

Baseline:21aa880 plus the [inventory audit](../verification/inventory-audit.md).
Scope: finish R0–R4 k6 replacement. These are completion criteria, not a claim
that each packet requires a new framework or that all existing evidence is stale.
Cleanup ACK/driver/recovery/settlement/protected retention are locally complete.
No new Goal, push, registry publication or deployment is authorised by this page.

## Functional implementation

| Packet | Inventory | Deliverable and exit condition | Dependencies |
| --- | --- | --- | --- |
| B01 namespace deletion | F02,N01 | Versioned scoped org/workspace/folder DELETE routes/controls; atomic refusals for protected children, inputs, runs and cleanup/replay ownership; exact retry and cross-scope/cycle tests | Review deletion semantics against retained epochs/tombstones before SQL |
| B02 directory inputs | F03 | Bounded tree selection/intake preserving relative folders; explicit per-file progress/conflicts/recovery; certify immutable replacement flow and pinned originals; no destructive overwrite | Existing input transfer/publication; B01 only for destructive interactions |
| B03 suite summaries | F04 | Bounded target/configured-duration/latest-run catalogue projection; unknowns explicit; no per-row config/result reads or false measured duration | Existing revision/history projection contracts |
| B04 diagnostic custody | F07,F11 | Bounded, redacted native diagnostics with durable viewing/replay and explicit overflow/loss; preserve secret/cancellation/output-budget ownership | Review source, schema, storage charge and retention lifetime first |
| B05 warning guidance | F10 | Closed native-warning classification and configured-executor guidance; uncertainty/heuristic labels; no automatic config changes | B04 provides diagnostics; reuse existing observed-drop advice |
| B06 organisation overview | F01 | Scoped cross-workspace summary/recent/active views with bounded snapshot reads and explicit coverage/unknowns | Existing workspace overview; agree exact aggregation contract |
| B07 recovery tooling | F12,F18 | Finish active-delivery restart cases; consistent bounded cold backup/restore, quiescence refusal, interrupted-restore startup fence, authority rotation and historical-only restored Runs | Delivery-authority contract; positive cleanup/settlement evidence already exists |

B01 is the next ready implementation packet. Inspect funded retention epochs,
permanent replay identities, references and deletion receipts before choosing
empty-only versus cascading behavior; do not invent a cascade to satisfy a route.
B02–B06 are independent after their contracts freeze; B04→B05 is sequential.
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
