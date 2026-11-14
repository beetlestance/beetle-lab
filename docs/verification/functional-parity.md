# Remaining functional parity

Status: inventory reconciliation at21aa880 plus this documentation-only audit.
[Full inventory audit](inventory-audit.md) maps every F01–F34/N01–N02;
[remaining packets](../execution/remaining-rewrite.md) own sequencing and exit criteria.
This supersedes the earlier targeted checklist, not its source-bound evidence.

| Inventory | Locally implemented | Remaining functional work |
| --- | --- | --- |
| F01 | Workspace counts/activity/recent/active navigation | Cross-workspace overview |
| F02/N01 | Scoped list/create/rename and folder moves | Protected organisation/workspace/folder deletion |
| F03 | Single-file upload/read/delete, immutable input pins | Directory-tree intake; certify immutable replacement/revision workflow |
| F04 | Explicit versioned suites and persisted editor/history | Catalogue target/duration/latest-run summary |
| F07/F11 | Durable lifecycle events, metric archives and replay | Retained bounded native diagnostic text and log viewing/replay |
| F10 | Observed drops and explicit iteration-median sizing heuristic | Native warning classification and configured-scenario guidance |
| F12 | Durable identity/reconciliation and native cleanup recovery | Remaining active-delivery restart matrix and supported cold restore |
| F19 | Rewrite source checks configured in CI | Matched rewrite-image smoke/publishing pipeline and release evidence |

F06 history filters/scalars/search, F13 comparison, F14 reports and protected Run
deletion, F15 public exports, F16 command search and F17 generated references are
locally implemented. Their packaged/browser/platform acceptance is still open;
see individual evidence from the full inventory audit. Cleanup ACK/driver/recovery,
settlement and protected retention completed through21aa880; they are no longer
implementation backlog entries.

No feature or release group is accepted merely because a route, test or report
exists. The acceptance audit records evidence limits and unclosed scenario mappings.
The25 baseline failures in [control evidence](backend-cleanup-control.md) are a
historical recorded result, not an assertion of today's failure count. Triage their
exact fixtures before the next integrated gate; this prose pass reran no suite.

UI redesign remains a separate later audit/plan. Additional engines, hosted IAM,
shared storage and test generation remain follow-on scope. No running service or
published image was changed by this reconciliation.
