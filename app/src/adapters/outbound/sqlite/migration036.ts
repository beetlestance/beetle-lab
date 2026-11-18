/** Diagnostic receipt time only; never scheduling, settlement or liveness authority. */
export const migration036 = `
ALTER TABLE export_jobs ADD COLUMN last_agent_report_at TEXT
 CHECK(last_agent_report_at IS NULL OR (
  typeof(last_agent_report_at)='text' AND length(last_agent_report_at)=24 AND
  last_agent_report_at IS strftime('%Y-%m-%dT%H:%M:%fZ',last_agent_report_at)));
PRAGMA user_version=36;
`;
