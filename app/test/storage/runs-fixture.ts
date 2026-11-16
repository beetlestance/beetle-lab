import type { CreateRunRequest } from '@beetle/contracts/api';
import type { MetadataOptions } from '../../src/adapters/outbound/sqlite/index.js';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { prepareRunCommand } from '../../src/application/runs/index.js';
import { digest, requestId, scope, settingsFixture, uuid } from './fixture.js';

export function runOptions(pendingLimit = 256): Pick<MetadataOptions, 'runs'> {
  return { runs: { pendingLimit, profiles: [{ engine: { id: 'k6', profileId: 'standard',
    imageDigest: `sha256:${'a'.repeat(64)}`, configVersion: 1 }, installedIdentity: {
      manifestId: 'k6-v1', profileId: 'docker-v1', catalogVersion: 1, manifestDigest: 'b'.repeat(64),
      profileDigest: 'c'.repeat(64), schemaDigest: createK6ConfigSchema(digest).schemaDigest }, requiredCapabilities: [] }] } };
}
export function runRequest(revisionId: string): CreateRunRequest {
  return { scope, requestId: requestId(), revisionId, engineProfile: 'standard',
    budget: settingsFixture().chain.installation.values.runDefaults.budget,
    executionPolicy: { mode: 'parallel', preferIdle: false } };
}
export function runCommand(revisionId: string, id = 70, request = runRequest(revisionId)) {
  return prepareRunCommand({ kind: 'createRun', id: uuid(id), attemptId: uuid(id + 100),
    requestedAt: '2026-11-09T00:00:00.000Z', request }, digest);
}
