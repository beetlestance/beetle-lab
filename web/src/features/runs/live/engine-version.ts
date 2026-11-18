import type { InstallationStatus, Run } from '@beetle/contracts/api';
/** A display label for this exact installed selector, never execution or availability authority. */
export function installedEngineVersion(status: InstallationStatus, run: Run): string | null {
  if (status.agent.state !== 'ready') return null;
  const matching = status.engines.filter(
    (item) =>
      item.profileId === run.engine.profileId &&
      item.imageDigest === run.engine.imageDigest &&
      item.image === 'verified_at_agent_start' &&
      item.engine?.id === run.engine.id &&
      item.engine.configVersion === run.engine.configVersion,
  );
  return matching.length === 1 ? matching[0]!.engine!.version : null;
}
