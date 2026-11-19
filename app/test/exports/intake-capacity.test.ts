import { expect, it } from 'vitest';
import { storageFixture, seed, observation } from '../storage/fixture.js';
import { createSuite, append, request } from '../storage/suites-fixture.js';
import { options, createCommand } from './fixture.js';
const f = storageFixture();
it.each(['unknown', 'shrunk'])(
  'preserves live installation validation for %s standalone export capacity',
  async (kind) => {
    const config = options();
    const metadata = await f.open(undefined, config);
    await seed(metadata);
    const body = request();
    body.config.secrets = [];
    const revision = await append(metadata, await createSuite(metadata), 60, body);
    if (kind === 'unknown') await metadata.updateRuntime(null);
    else {
      const ceilings = config.runtime!.ceilings;
      ceilings.pool.cpuMillis = config.installation!.values.pool.cpuMillis - 1;
      await metadata.updateRuntime(observation(ceilings));
    }
    await expect(metadata.exports.create(createCommand(revision.id))).rejects.toMatchObject({
      code: 'capacity_unavailable',
    });
  },
);
