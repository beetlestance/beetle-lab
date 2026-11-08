import { expect, it } from 'vitest';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import type { SuiteReader, SuiteStore } from '../../src/ports/suites.js';
import { prepareSuiteCommand, mutateSuite, getSuite, listRevisions } from '../../src/application/suites/index.js';
import { digest, scope, uuid } from '../storage/fixture.js';
import { request } from '../storage/suites-fixture.js';
const operation = { kind: 'createSuite' as const, id: uuid(50), request: { scope, requestId: uuid(99), name: 'Suite' } };
const suite: Suite = { id: uuid(50), scope, name: 'Suite', folderId: uuid(3), version: 1, currentRevisionId: null };
it('binds full intent and route identity, excludes CREATE allocations and snapshots before traversal', () => {
  const command = prepareSuiteCommand(operation, digest);
  expect(prepareSuiteCommand({ ...operation, id: uuid(51) }, digest).intentDigest).toBe(command.intentDigest);
  expect(prepareSuiteCommand({ ...operation, request: { ...operation.request, name: 'Changed' } }, digest).intentDigest).not.toBe(command.intentDigest);
  const revision = { kind: 'createSuiteRevision' as const, id: uuid(60), suiteId: suite.id, request: request() };
  expect(prepareSuiteCommand(revision, digest).intentDigest).not.toBe(prepareSuiteCommand({ ...revision, suiteId: uuid(51) }, digest).intentDigest);
  expect(prepareSuiteCommand({ ...revision, id: uuid(61) }, digest).intentDigest).toBe(prepareSuiteCommand(revision, digest).intentDigest);
  let invoked = false; const accessor = Object.defineProperty({ ...operation }, 'request', { enumerable: true, get() { invoked = true; return operation.request; } });
  expect(() => prepareSuiteCommand(accessor, digest)).toThrow(); expect(invoked).toBe(false);
  expect(Object.isFrozen(command.request)).toBe(true);
});
it('rejects foreign or malformed store output without publishing it', async () => {
  const store: SuiteStore = { execute: async () => ({ ...suite, scope: { ...scope, workspaceId: uuid(100) } }) };
  await expect(mutateSuite({ operation, digest, store })).rejects.toMatchObject({ code: 'not_found' });
  const malformed: SuiteStore = { execute: async () => ({ ...suite, currentRevisionId: undefined } as unknown as Suite) };
  await expect(mutateSuite({ operation, digest, store: malformed })).rejects.toThrow();
});
it('retains authority across broken reader mutations and binds revision page identity', async () => {
  const foreign = { ...suite, scope: { ...scope, organizationId: uuid(200) } };
  const reader: SuiteReader = {
    getSuite: async key => { Reflect.set(key.scope, 'organizationId', foreign.scope.organizationId); return foreign; },
    getRevision: async () => { throw new Error('unused'); }, listSuites: async () => ({ scope, items: [], nextCursor: null }),
    listRevisions: async () => ({ scope, suiteId: uuid(300), items: [], nextCursor: null }),
  };
  await expect(getSuite({ scope, id: suite.id }, reader)).rejects.toMatchObject({ code: 'not_found' });
  await expect(listRevisions({ scope, suiteId: suite.id, limit: 1 }, reader)).rejects.toMatchObject({ code: 'not_found' });
});
it('rejects revision receipt output bound to another suite', async () => {
  const revision: SuiteRevision = { id: uuid(60), scope, suiteId: uuid(51), ordinal: 1, engineId: 'k6', configVersion: 1,
    preflightStatus: 'passed', digest: 'a'.repeat(64), config: request().config, inputManifest: [] };
  await expect(mutateSuite({ operation: { kind: 'createSuiteRevision', id: uuid(60), suiteId: suite.id, request: request() },
    digest, store: { execute: async () => revision } })).rejects.toMatchObject({ code: 'not_found' });
});
