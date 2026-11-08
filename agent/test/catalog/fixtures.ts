import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { EngineManifest, Offer } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { EngineRegistration } from '../../src/catalog/index.js';

const schema = createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex'));
export function config() {
  return { version: 1, target: 'https://synthetic.invalid', datasets: [], secrets: [],
    requests: [{ id: 'read', name: 'read', method: 'GET', path: '/', query: {}, headers: {}, assertions: [] }],
    loadPlan: { version: 1, scenarios: [{ id: 'main', name: 'main', executor: 'per-vu-iterations',
      startTime: '0s', gracefulStop: '0s', vus: 1, iterations: 1, maxDuration: '1s' }], slos: [] },
    selections: [{ scenarioId: 'main', entries: [{ requestId: 'read', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }] };
}
export function offer(): Offer {
  const value = JSON.parse(readFileSync(new URL('../../../contracts/fixtures/valid/offer.json', import.meta.url), 'utf8')) as Offer;
  value.config = config(); return value;
}
export function registration(): EngineRegistration {
  const manifest = JSON.parse(readFileSync(new URL('../../../contracts/fixtures/valid/manifest.json', import.meta.url), 'utf8')) as EngineManifest;
  manifest.schemas.config = schema.schemaId;
  return { manifest, configVersion: 1, configSchema: schema,
    validation: { manifestId: 'k6-v1', profileId: 'docker-v1', schemaDigest: schema.schemaDigest, catalogVersion: 1 },
    profile: { installationId: '00000000-0000-4000-8000-000000000010', imageDigest: manifest.imageDigest,
      effectiveImage: { imageDigest: manifest.imageDigest, environment: ['PATH=/usr/local/bin:/usr/bin:/bin'], defaultRuntime: 'runc' },
      entrypoint: structuredClone(manifest.entrypoint), user: '10001:10001', stagingRoot: '/var/lib/beetle/staged',
      network: { profile: 'target-egress', name: 'beetle-targets' }, tmpfsBytes: 1_048_576,
      maximumBudget: { ...manifest.defaultBudget } } };
}
