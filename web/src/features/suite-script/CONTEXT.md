# Suite script

Route `routes.suiteScriptPattern`
(`/organizations/:organizationId/workspaces/:workspaceId/suites/:suiteId/revisions/:revisionId/script`),
built with `routes.suiteScript(org, workspace, suite, revision)`. App validates all
four IDs before mounting `SuiteScript`, which implements the "Script / revision N"
board with its Changes and One column variants.

- `index.tsx` reads the suite and revision; a missing or cross-suite revision shows
  `<NotFound kind="script" />`. The header shows the revision message and a saved
  line built only from fields the API returns (`savedAt`, `savedBy`, `runCount`).
- `ScriptSource` keeps at most 34 visible rows and a bounded Uint32 line index;
  Copy and Export use the full verified source, independent of the visible window.
  Export read errors offer retry and never claim the revision has no script.
- `ScriptTab.tsx` shows the exact latest accepted export when ready. There is no direct script
  read: text comes only from an export job, through `exports/scriptText.ts` (one
  bounded GET of exactly the published bytes, checked against the SHA-256). Scripts
  over 1 MiB are offered as a download. Input file names come from bounded
  `getInput` reads of the manifest (at most 64).
- `ChangesTab.tsx`, `useComparison.ts`, `diff.ts` and `changes.ts` compare the
  saved configuration JSON of two revisions of the same suite (first page of 100
  revisions), not the generated scripts. The LCS diff declines inputs above
  4M cells; long unchanged runs fold.
- "Run this revision" opens the suite page's Start run dialog (`suite-overview`
  `StartRun`) with this revision chosen. It is shown only after the workspace name
  the dialog needs has been read.

Checks: `diff.test.ts`, `script.test.tsx`.
