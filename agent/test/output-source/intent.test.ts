import { expect, it } from 'vitest';
import { captureCollectionIntent, prepareOutputSource } from '../../src/output-source/index.js';
import { assertFrozen, digest, input, intent } from './fixtures.js';

it('captures an immutable independent intent, preserving exact root bigint strings and scope spellings', () => {
  const value = intent(); value.binding.workspaceId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
  value.launch.key.workspaceId = value.binding.workspaceId;
  value.root.modifiedNs = '-1'; value.root.changedNs = '-1234567890123456789012345678901';
  const captured = captureCollectionIntent(value); expect(captured).toEqual(value);
  value.root.directory = '/changed'; value.launch.runtimeId = 'changed';
  expect(captured.root.directory).not.toBe(value.root.directory); expect(assertFrozen(captured)).toBe(true);
});
it.each(['scope', 'spec', 'device', 'runtime-time', 'begin-time', 'unknown', 'epoch', 'token', 'collection-id', 'authority'] as const)('rejects intent %s contradiction', kind => {
  const value = intent();
  const mutations = {
    scope: () => { value.launch.key.workspaceId = value.launch.key.attemptId; },
    spec: () => { value.launch.specDigest = '0'.repeat(64); },
    device: () => { value.root.device = '1'; },
    'runtime-time': () => { value.runtime.observedAt = value.launch.settledAt; },
    'begin-time': () => { value.begunAt = value.runtime.observedAt - 1; },
    unknown: () => { Reflect.set(value.launch, 'disposition', 'unknown'); },
    epoch: () => { Reflect.set(value.launch, 'disposition', 'completed'); },
    token: () => { value.launch.startToken = 'unexpected'; },
    'collection-id': () => { value.collectionId = 'NOT-A-UUID'; },
    authority: () => { value.binding.journalAuthority = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; },
  };
  mutations[kind]();
  expect(() => captureCollectionIntent(value)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
it('accepts completed and retired epoch1 with a definitive start token', () => {
  for (const disposition of ['completed', 'retired'] as const) {
    const value = intent(); value.launch.epoch = 1; value.launch.startToken = 'start'; value.launch.disposition = disposition;
    expect(captureCollectionIntent(value).launch.disposition).toBe(disposition);
  }
});
it.each(['id', 'runtime', 'collection', 'failed', 'spec', 'scope', 'epoch'] as const)('rejects collected source %s mismatch before hashing', kind => {
  const value = input(); let calls = 0;
  if (kind === 'id') value.collectionId = value.binding.attemptId;
  if (kind === 'runtime') Reflect.set(value.release.runtime, 'state', 'absent');
  if (kind === 'collection') value.release.collection.observedAt = value.release.runtime.observedAt - 1;
  if (kind === 'failed') Reflect.set(value.collection, 'ok', false);
  if (kind === 'spec') value.release.specDigest = '0'.repeat(64);
  if (kind === 'scope') value.release.key.generation++;
  if (kind === 'epoch') value.release.launch.startToken = 'unexpected';
  expect(() => prepareOutputSource(value, text => { calls++; return digest(text); })).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  expect(calls).toBe(0);
});
