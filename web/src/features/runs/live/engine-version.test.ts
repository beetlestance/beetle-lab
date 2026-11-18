import { expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import type { InstallationStatus } from '@beetle/contracts/api';
import base from '../../../../../contracts/fixtures/api/valid/installation-status.json' with { type: 'json' };
import { installedEngineVersion } from './engine-version.js';
import { liveRun } from './fixtures.js';
function status(): InstallationStatus {
  const run = liveRun();
  const checked = validateApi('InstallationStatus', {
    ...base,
    agent: { ...base.agent, state: 'ready' },
    engines: [
      {
        profileId: run.engine.profileId,
        imageDigest: run.engine.imageDigest,
        image: 'verified_at_agent_start',
        engine: { id: run.engine.id, version: '2.4.0', configVersion: run.engine.configVersion },
      },
    ],
  });
  if (!checked.ok) throw Error('Invalid synthetic status');
  return checked.value;
}
it('returns the declared installed version for exactly this run selector', () => {
  expect(installedEngineVersion(status(), liveRun())).toBe('2.4.0');
});
it.each(['profile', 'image', 'engine', 'config', 'missing', 'unverified', 'stale', 'duplicate'] as const)(
  'refuses unavailable or mismatched %s metadata',
  (cause) => {
    const value = status(),
      item = value.engines[0]!;
    if (cause === 'profile') item.profileId = 'foreign';
    if (cause === 'image') item.imageDigest = 'sha256:' + 'f'.repeat(64);
    if (cause === 'engine') item.engine!.id = 'foreign';
    if (cause === 'config') item.engine!.configVersion++;
    if (cause === 'missing') delete item.engine;
    if (cause === 'unverified') item.image = 'unknown';
    if (cause === 'stale') value.agent.state = 'stale';
    if (cause === 'duplicate') value.engines.push(structuredClone(item));
    expect(installedEngineVersion(value, liveRun())).toBeNull();
  },
);
