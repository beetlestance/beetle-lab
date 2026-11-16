/** Exact history filters retain the same bounded requested-time keyset path. */
export const migration017 = `
CREATE INDEX runs_history_outcome ON runs(organization_id,workspace_id,outcome,requested_at DESC,id DESC);
CREATE INDEX runs_history_state_outcome ON runs(organization_id,workspace_id,state,outcome,requested_at DESC,id DESC);
PRAGMA user_version=17;
`;
