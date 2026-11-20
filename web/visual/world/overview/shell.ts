// Engines page, error and not-found replies for the shell and navigation cases.
import type { Json } from '../../harness.js';
import { fixture } from '../index.js';
import { NOW } from '../../harness.js';
import { NOW_MS, iso } from './ids.js';
import { measuredStatus } from './workspace.js';

type Obj = Record<string, Json>;

export const serverError = (): Json => ({
  status: 500,
  body: {
    code: 'internal',
    message: 'The service is unavailable.',
    retryable: true,
    requestId: '00000000-0000-4000-8000-000000000010',
    fields: [],
  },
});

/** k6 installed, every other engine planned. */
export function engineCatalogue(): Obj {
  const base = fixture<{ engines: Obj[] }>('engine-catalogue');
  const planned = ['unit-tests', 'integration-tests', 'lint', 'formatting', 'mutation-testing'];
  return {
    ...base,
    generatedAt: NOW,
    engines: [
      { ...base.engines[0]! },
      ...planned.map((id) => ({ id, availability: 'planned', state: 'planned', profiles: [] })),
    ],
  };
}

/** Installation status for Engines; `stale` is an agent last heard from four minutes ago. */
export function enginesStatus(stale = false): Obj {
  const status = measuredStatus();
  const digest = `sha256:${'b'.repeat(64)}`;
  return {
    ...status,
    agent: stale
      ? { state: 'stale', lastSeenAt: iso(NOW_MS - 4 * 60_000), checkedAt: iso(NOW_MS - 1000) }
      : status.agent!,
    engines: [{ profileId: 'k6-local', imageDigest: digest, image: 'verified_at_agent_start' }],
  };
}
