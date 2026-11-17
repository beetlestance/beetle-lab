# Suite editor

Boards "Suite / Edit" (with its Request, Run setup and JSON views), "Panel / Save
revision" with its Errors state, "Overlay / Save conflict" and "Tablet / Suite /
Edit". `suites/RevisionEditor` mounts it on the suite page's Edit tab
(`?tab=edit`, owned by `suites/SuiteDetail`); `suites/ConfigFields` switches between
the form, Run setup and complete JSON. Those views have no sub-route yet, so the
selected view lives in component state.

The draft text is the only source of truth. Each form edit re-encodes the whole
config through `suites/draft` (1 MiB and JSON limits). An edit that would overflow
is refused and named, never applied in part. Fields the form does not show
(secrets, unknown keys) pass through unchanged.

`validate` blocks a save that is certain to fail (paths, weights, durations,
stages, rules). `serverProblems` maps ApiError `fields` (`/config/...`) back to
field ids. Every problem is a jump-to button that switches view and focuses the
field. `useInputCatalog` lists published inputs (a single page of 100) and reads
each referenced input (capped at 64). It names a deleted or missing input as a
blocker. The revision message goes in the 031 `message` field. On a 409, the
conflict overlay reads the suite and its current revision fresh and saves the
kept draft on top with a new request id.

Name, folder and description are suite metadata, edited by `suites/MetadataEditor`.
CSV column names are not in the API, so the value palette shows only a COLUMN
placeholder.

Checks: `npx vitest run web/src/features/suite-editor web/src/app/suites.test.tsx`.
