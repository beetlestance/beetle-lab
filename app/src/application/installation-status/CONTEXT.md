# Installation status

AgentStatusBoard keeps only the latest capacity sample outcome and the last ready facts in
memory; clock rollback cannot replace a newer outcome. getInstallationStatus derives the
agent state (disabled/unknown/unreachable/unavailable/stale/ready, 5000 ms freshness) and
reports host or disk quantities as measured only from a fresh ready sample; otherwise
unknown or not_measured, never zero. getRunQueue adds the route scope and requires the
stored run identity. Both validate a <=64 KiB response and never contact the agent or
authorize dispatch. See docs/system/contracts/resources.md#installation-status-read.
Focused checks: npx vitest run app/test/application/installation-status.test.ts
