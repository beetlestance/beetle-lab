# Suite script

Route `routes.suiteScriptPattern`
(`/organizations/:organizationId/workspaces/:workspaceId/suites/:suiteId/revisions/:revisionId/script`),
built with `routes.suiteScript(org, workspace, suite, revision)`. App validates all
four IDs before mounting `SuiteScript`, which implements the "Script / revision N"
board with its Changes and One column variants.

- `ScriptNamespace` verifies organisation/workspace and warms their real names.
  Retained-data guards on namespace/suite/revision keep unknown export replay alive
  through refresh errors; initial not-found and foreign-suite data still refuse.
- Optional `?run=<UUID>` comes from live/result links. Breadcrumbs verify the scoped
  run belongs to this suite; selected script revision is labelled separately.
  Duplicate/malformed origins never issue a read. Scope retirement cancels inactive
  reads; restored history keeps Run this revision visible and disabled.
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
- Changes compares two verified generated JavaScript artifacts, using the scoped
  latest export for each revision (revision choices: first page of 100). The shared
  `script-read.ts` binds scope, revision digest and artifact identity before reading
  or showing cached bytes. Configuration-derived summary chips stay separate.
- Comparison never creates exports automatically. Missing scripts offer explicit
  preparation and recheck; errors stop polling. LCS declines more than 4,096 combined
  lines or 4M cells before allocation; unchanged runs fold. Split/unified views
  share the same real line counts and bounded source.
- "Run this revision" opens the suite page's Start run dialog (`suite-overview`
  `StartRun`) with this revision chosen. It is shown only after the workspace name
  the dialog needs has been read.

Checks: `diff.test.ts`, `script.test.tsx`.
