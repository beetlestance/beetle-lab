# Suite configuration and exact history

Status: reviewed local F04/F06 slice based onf4abdb7.
[Contract](../design/lld/suite-overview.md). Current placement is the selected
suite/revision view; catalogue rows remain lean for the later UI redesign.

Saved revisions now show target origin and a bounded configured schedule. The
existing revision read supplies the data; no extra configuration request, compiler,
secret resolution, persistent projection or quota allowance was introduced.
Literal workload/iteration-limit/discovery-step durations and capped stage lists
are labelled configuration, not measured or derived whole-run duration. At most8
scenarios/6 stage times are displayed, with explicit remaining counts. Credentials,
path/query and fragment do not enter the origin label. Unknown source stays unknown.

Latest retained submission is an exact suite-filtered limit1 read, with links to
that Run and full suite history. Earlier revisions remain included under the same
suite identity; deleted Runs are not reconstructed. No retained runs does not
mean the suite never executed. Errors hide cached evidence and allow manual refresh.

## History authority and bounds

Public suiteId resolves under its requested workspace before name-index work.
Cursor binding is also checked first. Name search intersects the exact suite;
prefix search retains its existing256 workspace-candidate cap before filters.
Existing suite/time/state/outcome indexes provide keyset reads. No new migration,
OFFSET, per-row config/result read or native request was added.

No-suite v1/v2 cursor encodings are unchanged; v3 binds the suite and normal query.
Client reply guards and cache keys include suiteId. Validated suiteId URL context
opens full history; ordinary filter reset keeps it, while an explicit link clears
back to workspace history. Ambiguous/invalid context refuses before fetch.

## Checks and limits

The initial46-case history/search/UI lane passed43 and exposed three setup failures:
raw SQLite updates/deletion omitted registered validation functions, and the258-Run
prefix fixture lacked the existing queued cleanup reserve. The affected files then
passed five cases; the final capacity case passed in2.20s after providing explicit
20MB logical storage. Workload counts, prefix bound and assertions were preserved.
Unaffected green source evidence was reused. Initial serializer omission and
complexity failures were also retained and corrected without changing gates.

The corrected new behavior/cursor/UI scope lane passed13 cases in10.84s. Actual
paired authenticated TCP/application/generated-client suite paging and compiled-worker
reopen passed one case in8.74s, creating metadata Runs without engine execution.
Independent review found and cleared validation-before-backfill ordering; its
pending-index foreign-suite regression preserves all index/progress rows.

Frozen Node/web types, lint, architecture, docs, API drift and API/web builds passed.
Source-bound plans, full failures and correction logs remain private. No full-suite,
native k6, browser-visual, container/release or per-row catalogue qualification is
claimed. User data/services and published artifacts were unchanged.
