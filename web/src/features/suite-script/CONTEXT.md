# Suite script

Route `routes.suiteScriptPattern`
(`/organizations/:organizationId/workspaces/:workspaceId/suites/:suiteId/revisions/:revisionId/script`),
built with `routes.suiteScript(org, workspace, suite, revision)`. App validates all
four IDs before mounting `SuiteScript`. Placeholder until Wave 1 package C
implements the "Script / revision" boards; a missing script uses
`<NotFound kind="script" />` from `components/NotFound`.
