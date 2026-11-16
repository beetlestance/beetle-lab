/** Organisation-wide header order, no table/data/authority changes. */
export const migration027=`
CREATE INDEX runs_org_overview_recent ON runs(organization_id,requested_at DESC,id DESC);
CREATE INDEX runs_org_overview_active ON runs(organization_id,state,requested_at DESC,id DESC);
PRAGMA user_version=27;
`;
