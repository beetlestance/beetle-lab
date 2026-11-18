/** Latest export is acceptance order, independent of wall clocks and public UUID pagination. */
export const migration035 = `
CREATE INDEX exports_revision_latest ON export_jobs(organization_id,workspace_id,revision_id,queue_order DESC);
PRAGMA user_version=35;
`;
