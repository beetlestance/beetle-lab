/** Read-only dashboard access paths; no table/authority/data changes. */
export const migration016=`
CREATE INDEX runs_overview_recent ON runs(organization_id,workspace_id,requested_at DESC,id DESC);
CREATE INDEX runs_overview_active ON runs(organization_id,workspace_id,state,requested_at DESC,id DESC);
PRAGMA user_version=16;
`;
