# Installation status reads

getPoolUsage and getRunQueue are worker-side read-only snapshots in one transaction,
allowed in historical mode. They mirror dispatch accounting: charged execution_records
and export_jobs (more than 64 rows is unavailable), queued counts through the pending
partial indexes, and position from immutable queue_order across uncancelled queued runs
and exports. Holders are named only within the requested workspace; other workspaces
are counted. Untracked legacy intents report a null position. Operations are a closed
envelope (kind, key, optional transport messageId). No migration.
Focused checks: npx vitest run app/test/storage/installation-status.test.ts
