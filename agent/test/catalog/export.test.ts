import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createStandaloneExportAssignment } from '@beetle/contracts';
import type { EngineRegistration } from '../../src/catalog/index.js';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { offer, registration } from './fixtures.js';

it('registers the fixed offline export profile and recovers only its exact assignment', () => {
  const source = registration();
  source.manifest.schemas.result = 'https://beetle-lab.dev/contracts/runner/v1/export-result';
  source.manifest.capabilities = ['standalone-export-v1'];
  source.manifest.network = {required: false, profile: 'none'};
  source.manifest.entrypoint = {executable: 'node', arguments: ['/beetle/bootstrap/export-main.js']};
  const installed: EngineRegistration = {...source, profile: {...source.profile, entrypoint: source.manifest.entrypoint,
    network: {profile: 'none', name: 'none'}}};
  const catalog = createEngineCatalog([installed]);
  const job = offer(installed); job.requiredCapabilities = ['standalone-export-v1'];
  job.inputs = []; job.secretReferences = [];
  const assignment = createStandaloneExportAssignment({version: 1, purpose: 'standalone_export',
    exportId: randomUUID(), requestId: randomUUID(), source: {revisionId: randomUUID(), revisionDigest: 'c'.repeat(64)},
    offer: job, options: {scriptTimeoutMs: 1000, maximumBuildBytes: 1048576}},
  value => createHash('sha256').update(value).digest('hex'));
  const accepted = catalog.preflightExport(assignment);
  expect(catalog.resolve(job, accepted.validation, assignment)).toBe(accepted.engine);
  expect(() => catalog.preflight(job)).toThrow('unapproved_engine');
  expect(() => catalog.resolve(job, accepted.validation)).toThrow('identity');
  const egress: EngineRegistration = {...installed, profile: {...installed.profile, network: {profile: 'target-egress', name: 'targets'}}};
  expect(() => createEngineCatalog([egress])).toThrow('invalid_registration');
});
