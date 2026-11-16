import revisionRequest from '../../../contracts/fixtures/api/valid/create-suite-revision.json' with { type: 'json' };
import type { CreateSuiteRevisionRequest, Suite, SuiteRevision } from '@beetle/contracts/api';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { prepareSuiteCommand } from '../../src/application/suites/index.js';
import { digest, requestId, scope, uuid } from './fixture.js';
export const suiteCommand = (operation: Parameters<typeof prepareSuiteCommand>[0]) => prepareSuiteCommand(operation, digest);
export async function createSuite(metadata: Metadata, id = 50, owner = scope, name = `Suite ${id}`): Promise<Suite> {
  return await metadata.suites.execute(suiteCommand({ kind: 'createSuite', id: uuid(id),
    request: { scope: owner, requestId: requestId(), name } })) as Suite;
}
export function request(version = 1): CreateSuiteRevisionRequest {
  return { ...structuredClone(revisionRequest), scope, requestId: requestId(), expectedVersion: version } as CreateSuiteRevisionRequest;
}
export async function append(metadata: Metadata, suite: Suite, id = 60, value = request(suite.version)): Promise<SuiteRevision> {
  return await metadata.suites.execute(suiteCommand({ kind: 'createSuiteRevision', id: uuid(id), suiteId: suite.id, request: value })) as SuiteRevision;
}
export function largeConfig(bytes = 1048576): CreateSuiteRevisionRequest['config'] {
  const config = request().config;
  config.datasets = [{ id: 'data', kind: 'inline', selection: 'byVu', rows: [] }];
  const rows = (config.datasets as { rows: { text: string }[] }[])[0]!.rows;
  while (Buffer.byteLength(JSON.stringify(config)) + 3000 < bytes) rows.push({ text: '界'.repeat(990) });
  const spare = bytes - Buffer.byteLength(JSON.stringify(config)) - 12;
  rows.push({ text: 'x'.repeat(spare) });
  return config;
}
