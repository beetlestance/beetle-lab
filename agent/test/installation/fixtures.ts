import { afterEach, expect } from 'vitest';
import { createConfigSchema } from '@beetle/contracts/engine-config';
import { createHash } from 'node:crypto';
import type { Offer } from '@beetle/contracts';
import type { Catalog, InstalledEngine } from '../../src/catalog/index.js';
import type { InstallationController } from '../../src/installation/index.js';
import { createInstallationController } from '../../src/installation/index.js';
import type { InstallationOptions } from '../../src/installation/index.js';
import { fixture as stagingFixture, operation } from '../staging/fixtures.js';
import { controlled, deferred, scope } from '../supervisor/fixtures.js';
import { configuration, validation } from '../admission/fixtures.js';
export { operation, scope, deferred, validation };
export function fixture() {
  const f = stagingFixture(); const managers: InstallationController[] = [];
  afterEach(async () => { await Promise.allSettled(managers.splice(0).map(manager => manager.close())); });
  return { ...f, async setup() {
    const env = await f.environment(false);
    const owner = controlled(env.owner); owner.time.advance(1);
    const engine: InstalledEngine = { manifest: env.options.manifest, profile: env.options.profile,
      configVersion: 1, validation: env.options.validation, approved: configuration().profiles[0]!,
      configSchema: createConfigSchema({ schemas: [{ $id: 'synthetic', type: 'object' }], schemaId: 'synthetic', digest: value => createHash('sha256').update(value).digest('hex') }) };
    const catalog: Catalog = { engines: [engine], preflight(input: unknown) {
      const offer = structuredClone(input) as Offer;
      return { offer, engine, validation: validation(offer) };
    }, resolve(_offer, identity) {
      if (identity.schemaDigest !== engine.validation.schemaDigest) throw new Error('synthetic missing pin');
      return engine;
    } };
    const stager = env.create({ wallNow: owner.time.wall });
    const options: InstallationOptions = { journal: env.owner, catalog, supervisor: owner.manager,
      timeout: { watch: () => {
        let closed = false;
        return { status: () => ({ ready: !closed, closed, stopRequested: false, reason: null }),
          close: async () => { closed = true; } };
      } },
      guard: { watch: () => {
        let closed = false;
        return { initial: Promise.resolve({ ready: true }),
          status: () => ({ ready: !closed, closed, stopRequested: false, lastKnownAt: 0 }),
          close: async () => { closed = true; } };
      } },
      stagerFor: () => stager, wallNow: owner.time.wall };
    const create = (overrides: Partial<InstallationOptions> = {}) => {
      const manager = createInstallationController({ ...options, ...overrides }); managers.push(manager); return manager;
    };
    const finish = async (manager: InstallationController, offer = env.offer) => {
      for (let i = 0; i < 12; i++) {
        owner.time.advance(1);
        const result = await manager.drive(scope(offer), operation());
        if (result.kind === 'released') return result;
        if (owner.backend.observation.state === 'running') owner.backend.observation = owner.backend.known('exited').value;
      }
      throw new Error('synthetic attempt did not release');
    };
    return { ...env, ...owner, engine, catalog, stager, options, create, finish,
      async accepted(manager: InstallationController, offer = env.offer) {
        expect((await manager.enqueue(offer)).accepted).toBe(true);
      } };
  } };
}
