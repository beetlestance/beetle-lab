# Remaining functional parity

Status: reconciled at4e2eba0 with the directory-input implementation below.
Local evidence remains scoped to its recorded source and environment.
[Full inventory audit](inventory-audit.md) maps every F01–F34/N01–N02;
[remaining packets](../execution/remaining-rewrite.md) own sequencing and exit criteria.
This supersedes the earlier targeted checklist, not its source-bound evidence.

| Inventory | Locally implemented | Remaining functional work |
| --- | --- | --- |
| F01 | Workspace and organisation-wide counts/activity/recent/active navigation | Packaged browser/platform acceptance |
| F02/N01 | Scoped list/create/rename/move and protected empty-only deletion | Nonempty recursive maintenance remains unsupported; packaged acceptance |
| F03 | Single-file and bounded directory upload/read/delete, immutable input/revision pins | [Directory evidence](directory-inputs.md); packaged browser/platform acceptance |
| F04 | Versioned suites, selected-revision target/schedule summary and exact-suite latest/full history | Catalogue placement remains provisional; packaged acceptance |
| F07/F11 | Durable lifecycle events, metric archives and replay | Retained bounded native diagnostic text and log viewing/replay |
| F10 | Observed drops, bounded native warning classification and configured single-arrival iteration-median guidance | Packaged/browser/platform acceptance; [warning evidence](k6-warning-guidance.md) |
| F12 | Durable identity/reconciliation, native cleanup and cold historical restore | [Recovery evidence](cold-recovery.md); remaining active-delivery crash/platform matrix |
| F19 | Rewrite source checks configured in CI | Matched rewrite-image smoke/publishing pipeline and release evidence |

F06 history filters/scalars/search, F13 comparison, F14 reports and protected Run
deletion, F15 public exports, F16 command search and F17 generated references are
locally implemented. Their packaged/browser/platform acceptance is still open;
see individual evidence from the full inventory audit. Cleanup ACK/driver/recovery,
settlement and protected retention completed through21aa880; cold recovery followed
at4e2eba0. They are no longer implementation backlog entries.

No feature or release group is accepted merely because a route, test or report
exists. The acceptance audit records evidence limits and unclosed scenario mappings.
The25 baseline failures in [control evidence](backend-cleanup-control.md) are a
historical recorded result, not an assertion of today's failure count. Triage their
exact fixtures before the next integrated gate; this prose pass reran no suite.

UI redesign remains a separate later audit/plan. Additional engines, hosted IAM,
shared storage and test generation remain follow-on scope. No user service or
published image was changed by this work.
