# Installation status

AgentStatusBoard keeps only the latest capacity sample outcome and the last ready facts in
memory; clock rollback cannot replace a newer outcome. getInstallationStatus derives the
agent state (disabled/unknown/unreachable/unavailable/stale/ready, 5000 ms freshness) and
reports host or disk quantities as measured only from a fresh ready sample; otherwise
unknown or not_measured, never zero. getRunQueue adds the route scope and requires the
stored run identity. Both validate a <=64 KiB response and never contact the agent or
authorize dispatch. See docs/system/contracts/resources.md#installation-status-read.
Focused checks: npx vitest run app/test/application/installation-status.test.ts

Optional installed engine metadata requires fresh ready facts and one exact approved
profile/engine/config/image match. Invalid/ambiguous metadata stays absent. Board
facts and their nested fields are copied/frozen; no caller aliases survive.
Version is not historical-run evidence. See contracts/engine-metadata.md.
engineCatalogue maps one status read to installed k6 plus PLANNED_ENGINES. getUpgradeStatus
(upgrade.ts) reports release, schema, fence, unfinished work and backup size (contracts/upgrade.md).
